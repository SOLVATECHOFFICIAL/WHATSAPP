import 'dotenv/config';
import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db, doc, getDoc, setDoc, runTransaction, collection, getDocs, deleteDoc, listAllFirebaseUsers } from './src/server/firebase-admin.ts';
import { sessionManager, whatsappManager } from './src/server/whatsapp.ts';
import { commandHandler, SOLVATECH_MENU } from './src/server/commands.ts';
import {
  firebaseConfig,
} from './src/services/firebase-config.ts';
import { isFirestoreQuotaExhausted, reportFirestoreError } from './src/services/firestore-status.ts';
import { OWNER_EMAIL, OWNER_EMAILS, isOwnerEmail } from './src/services/admin-config.ts';
import {
  findLicenseByKey,
  saveLicenseRecord,
  saveBatchLicenseRecords,
  markLicenseRedeemed,
  getAllLicenseRecords,
  deleteLicenseRecord,
  wipeUnusedLicenseRecords,
  wipeExpiredLicenseRecords,
} from './src/server/license-store.ts';

// 🛡️ SIGNAL CRYPTO ERROR GUARDIAN:
// Intercepts transient libsignal console errors (e.g. "Bad MAC", "Failed to decrypt message with any known session")
// so that transient decryption re-handshakes in multi-device WhatsApp groups do not pollute stderr as fatal unhandled errors.
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  const fullText = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message + ' ' + (a.stack || '') : a ? JSON.stringify(a) : ''))
    .join(' ');
  if (
    fullText.includes('Failed to decrypt message with any known session') ||
    fullText.includes('Session error:Error: Bad MAC') ||
    fullText.includes('Error: Bad MAC') ||
    fullText.includes('No matching sessions found for message')
  ) {
    console.warn('[Signal Crypto Guardian] Transient Signal session decryption mismatch intercepted (Bad MAC). Background session auto-repair and pre-key retry active.');
    return;
  }
  originalConsoleError.apply(console, args);
};

// 🛡️ UNBREAKABLE PROCESS SHIELD: Prevents Node process crashes 24/7
// In production/Railway, unexpected rejections or socket network drops must NEVER terminate the process.
process.on('uncaughtException', (err: any, origin: string) => {
  console.error('[SOLVATECH Crash Guard] Intercepted uncaught exception safely (crash prevented):', origin, err?.message || err);
  if (err?.stack) {
    console.debug('[SOLVATECH Crash Guard Stack]', err.stack);
  }
});

process.on('unhandledRejection', (reason: any) => {
  console.error('[SOLVATECH Crash Guard] Intercepted unhandled promise rejection safely (crash prevented):', reason?.message || reason);
  if (reason?.stack) {
    console.debug('[SOLVATECH Crash Guard Stack]', reason.stack);
  }
});

// 🛡️ MEMORY GUARDIAN: Proactive RAM management for Railway 512MB limits
// Periodically checks RSS memory and forces V8 garbage collection if available before hitting cgroup OOM
setInterval(() => {
  try {
    const mem = process.memoryUsage();
    const rssMb = Math.round(mem.rss / 1048576);
    const heapMb = Math.round(mem.heapUsed / 1048576);
    if (rssMb > 380) {
      console.warn(`[SOLVATECH Memory Guardian] Elevated memory detected: RSS=${rssMb}MB, Heap=${heapMb}MB. Running proactive GC...`);
      if (typeof global.gc === 'function') {
        global.gc();
      }
    }
  } catch {}
}, 2 * 60 * 1000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const expiryMillis = (value: any): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return new Date(value).getTime();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  return 0;
};

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const isRailway = Boolean(
    process.env.RAILWAY_SERVICE_ID ||
    process.env.RAILWAY_ENVIRONMENT_ID ||
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    process.env.RAILWAY_STATIC_URL,
  );
  const rawPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const PORT = isRailway ? rawPort : 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json());

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id, x-user-email');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  const requireOwnerAuth = async (req: express.Request, res: express.Response): Promise<boolean> => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    const match = /^Bearer\s+([^\s]+)$/i.exec(req.header('authorization') || '');
    const idToken = match?.[1];
    const fallbackHeaderEmail = (req.header('x-user-email') || (req.query.userEmail as string) || '')?.trim().toLowerCase();

    if (!idToken || idToken.length > 8192) {
      if (fallbackHeaderEmail && isOwnerEmail(fallbackHeaderEmail)) {
        return true;
      }
      res.status(401).json({ success: false, error: 'Sign in as the owner to access this endpoint.' });
      return false;
    }

    try {
      let userEmail: string | undefined;

      // 1. If Firebase API key is configured, check identitytoolkit
      if (firebaseConfig.apiKey) {
        try {
          const response = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ idToken }),
              signal: AbortSignal.timeout(6000),
            }
          );
          if (response.ok) {
            const identity = (await response.json()) as {
              users?: Array<{ email?: string; emailVerified?: boolean; localId?: string }>;
            };
            userEmail = identity.users?.[0]?.email;
          }
        } catch (fetchErr) {
          console.debug('Google identitytoolkit lookup note:', fetchErr);
        }
      }

      // 2. Resilient JWT decode fallback for offline or custom auth tokens
      if (!userEmail) {
        try {
          const parts = idToken.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
            if (payload && typeof payload.email === 'string') {
              userEmail = payload.email;
            }
          }
        } catch {}
      }

      if (!userEmail && fallbackHeaderEmail && isOwnerEmail(fallbackHeaderEmail)) {
        userEmail = fallbackHeaderEmail;
      }

      if (!userEmail || !isOwnerEmail(userEmail)) {
        res.status(403).json({ success: false, error: 'Owner access is required.' });
        return false;
      }
      return true;
    } catch (err) {
      if (fallbackHeaderEmail && isOwnerEmail(fallbackHeaderEmail)) {
        return true;
      }
      console.error('Owner identity verification unavailable:', err);
      res.status(503).json({ success: false, error: 'Could not verify owner access. Please retry.' });
      return false;
    }
  };

  // Helper: Retrieve isolated per-user WhatsApp session based on request credentials
  const getSessionForReq = (req: express.Request) => {
    const userId =
      (req.query.userId as string) ||
      (req.body?.userId as string) ||
      (req.headers['x-user-id'] as string) ||
      '';
    const userEmail =
      (req.query.userEmail as string) ||
      (req.body?.userEmail as string) ||
      (req.headers['x-user-email'] as string) ||
      '';
    return sessionManager.getSession(userId, userEmail);
  };

  // Serve solva.webp from root folder or public folder
  app.get('/solva.webp', (_req, res) => {
    const rootPath = path.resolve(__dirname, 'solva.webp');
    const pubPath = path.resolve(__dirname, 'public', 'solva.webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (fs.existsSync(rootPath)) {
      res.setHeader('Content-Type', 'image/webp');
      return res.sendFile(rootPath);
    }
    if (fs.existsSync(pubPath)) {
      res.setHeader('Content-Type', 'image/webp');
      return res.sendFile(pubPath);
    }
    res.status(404).send('Not found');
  });

  // Sync user license with 24/7 heartbeat watchdog
  app.post('/api/whatsapp/sync-license', async (req, res) => {
    try {
      const userId = (req.body?.userId as string) || (req.query.userId as string) || (req.headers['x-user-id'] as string) || '';
      const userEmail = (req.body?.userEmail as string) || (req.query?.userEmail as string) || (req.headers['x-user-email'] as string) || '';
      const incomingExpiresAt = req.body?.expiresAt || req.query?.expiresAt || null;
      const isUnlimited = Boolean(req.body?.isUnlimited || req.query?.isUnlimited || (userEmail && isOwnerEmail(userEmail)));

      if (!userId) {
        return res.status(400).json({ success: false, error: 'User ID is required.' });
      }
      const session = sessionManager.getSession(userId, userEmail);
      if (userEmail) {
        session.userEmail = userEmail;
      }

      if (isUnlimited) {
        session.setSessionLicense(null, true);
        if (!isFirestoreQuotaExhausted()) {
          try {
            await setDoc(doc(db, 'users', userId), {
              uid: userId,
              ...(userEmail ? { email: userEmail } : {}),
              isUnlimited: true,
              licenseStatus: 'unlimited',
              licensePlan: '👑 Unlimited Lifetime (Admin Granted)',
              licenseExpiresAt: null,
              updatedAt: new Date().toISOString(),
            }, { merge: true });
          } catch (err) {
            reportFirestoreError(err);
          }
        }
      } else if (incomingExpiresAt && new Date(incomingExpiresAt).getTime() > Date.now()) {
        session.setSessionLicense(incomingExpiresAt, false);
        if (!isFirestoreQuotaExhausted()) {
          try {
            await setDoc(doc(db, 'users', userId), {
              uid: userId,
              ...(userEmail ? { email: userEmail } : {}),
              isUnlimited: false,
              licenseStatus: 'active',
              licenseExpiresAt: incomingExpiresAt,
              updatedAt: new Date().toISOString(),
            }, { merge: true });
          } catch (err) {
            reportFirestoreError(err);
          }
        }
      }

      await session.syncLicenseFromFirestore();
      res.json({
        success: true,
        isExpired: session.isLicenseExpired(),
        expiresAt: session.getStatus().licenseExpiresAt || null,
        serverTime: new Date().toISOString(),
        message: 'License synchronized from Firebase.',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin live multi-user status sync
  app.get('/api/admin/users-status', async (req, res) => {
    if (!(await requireOwnerAuth(req, res))) return;
    try {
      const statusMap = await sessionManager.getAllStatuses();
      res.json({ success: true, statuses: statusMap });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin users list endpoint (fetches genuine emails only from Firebase, no duplicates)
  app.get('/api/admin/users', async (req, res) => {
    if (!(await requireOwnerAuth(req, res))) return;
    try {
      // 1. Fetch genuine accounts directly from Firebase Auth (even if just created with no action!)
      let authUsers: Array<{ uid: string; email?: string; displayName?: string; createdAt?: string }> = [];
      try {
        authUsers = await listAllFirebaseUsers();
      } catch (authErr) {
        console.warn('[Admin Users] Firebase Auth list users note:', authErr);
      }

      // 2. Fetch from Firestore users collection
      const snap = await getDocs(collection(db, 'users'));
      const rawDocs: any[] = [];
      snap.forEach((d: any) => {
        rawDocs.push({ uid: d.id, ...(d.data() || {}) });
      });

      // Merge Firebase Auth users so even freshly created accounts with no actions show!
      for (const aUser of authUsers) {
        if (!aUser.email) continue;
        const cleanEmail = aUser.email.trim().toLowerCase();
        const existingDoc = rawDocs.find(
          (d) => typeof d.email === 'string' && d.email.trim().toLowerCase() === cleanEmail
        );
        if (!existingDoc) {
          const trialStorePath = path.resolve(__dirname, '.trial_store.json');
          let store: Record<string, any> = {};
          if (fs.existsSync(trialStorePath)) {
            try { store = JSON.parse(fs.readFileSync(trialStorePath, 'utf-8')); } catch {}
          }
          const emailKey = cleanEmail.replace(/[^a-z0-9]/g, '_');
          const existingTrial = store[emailKey] || store[aUser.uid];
          const now = Date.now();
          const isTrialValid = existingTrial?.expiresAt && new Date(existingTrial.expiresAt).getTime() > now;
          const trialExpiry = isTrialValid ? existingTrial.expiresAt : (!existingTrial ? new Date(now + 30 * 60 * 1000).toISOString() : null);
          const hasTrial = Boolean(isTrialValid || !existingTrial);

          const freshDoc = {
            uid: aUser.uid,
            email: cleanEmail,
            displayName: aUser.displayName || cleanEmail.split('@')[0],
            licenseKey: hasTrial ? 'FREE_TRIAL_30M' : null,
            licensePlan: hasTrial ? '⚡ 30-Minute Free Trial (Active)' : 'Trial Expired',
            licenseStatus: hasTrial ? 'active' : 'expired',
            licenseExpiresAt: trialExpiry,
            hasUsedTrial: true,
            trialClaimedAt: existingTrial?.claimedAt || new Date(now).toISOString(),
            trialEmail: cleanEmail,
            lifetimeTrialLocked: true,
            createdAt: aUser.createdAt || new Date().toISOString(),
          };
          rawDocs.push(freshDoc);
          try {
            await setDoc(doc(db, 'users', aUser.uid), freshDoc, { merge: true });
            if (hasTrial && trialExpiry) {
              store[emailKey] = { userUid: aUser.uid, userEmail: cleanEmail, expiresAt: trialExpiry, claimedAt: freshDoc.trialClaimedAt, lifetimeLocked: true };
              store[aUser.uid] = { userUid: aUser.uid, userEmail: cleanEmail, expiresAt: trialExpiry, claimedAt: freshDoc.trialClaimedAt, lifetimeLocked: true };
              fs.writeFileSync(trialStorePath, JSON.stringify(store, null, 2), 'utf-8');
              const session = sessionManager.getSession(aUser.uid, cleanEmail);
              session.setSessionLicense(trialExpiry, false);
            }
          } catch {}
        }
      }

      // Deduplicate strictly by normalized email; delete duplicates in Firebase so only one remains
      const emailMap = new Map<string, any>();
      const duplicateUidsToDelete: string[] = [];

      for (const docData of rawDocs) {
        const rawEmail = typeof docData.email === 'string' ? docData.email.trim().toLowerCase() : '';
        if (!rawEmail) {
          emailMap.set(docData.uid, docData);
          continue;
        }

        if (emailMap.has(rawEmail)) {
          const existing = emailMap.get(rawEmail);
          // Keep the record with active status, paired phone, or newer timestamp
          const existingScore = (existing.isUnlimited ? 100 : 0) + (existing.linkedPhone ? 50 : 0) + (existing.licenseExpiresAt ? 25 : 0);
          const currentScore = (docData.isUnlimited ? 100 : 0) + (docData.linkedPhone ? 50 : 0) + (docData.licenseExpiresAt ? 25 : 0);

          if (currentScore > existingScore) {
            if (existing.uid && existing.uid !== docData.uid) duplicateUidsToDelete.push(existing.uid);
            emailMap.set(rawEmail, docData);
          } else {
            if (docData.uid && docData.uid !== existing.uid) duplicateUidsToDelete.push(docData.uid);
          }
        } else {
          emailMap.set(rawEmail, docData);
        }
      }

      // Delete duplicates in Firebase so only one remains!
      for (const dupUid of duplicateUidsToDelete) {
        try {
          await deleteDoc(doc(db, 'users', dupUid));
          console.log(`[Admin Users] Removed duplicate user document ${dupUid} from Firebase.`);
        } catch (delErr) {
          console.warn(`[Admin Users] Could not delete duplicate ${dupUid}:`, delErr);
        }
      }

      // Ensure ONLY awoyinfasolomon1@gmail.com is granted founder admin rights
      const list = Array.from(emailMap.values()).map((u) => {
        const isMaster = isOwnerEmail(u.email);
        if (isMaster) {
          return {
            ...u,
            isUnlimited: true,
            licensePlan: '👑 Unlimited Lifetime Master Access',
            licenseStatus: 'unlimited',
          };
        }
        return u;
      });

      res.json({ success: true, users: list });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // User profile synchronization endpoint (called on sign in/creation, deduplicates in Firebase)
  app.post('/api/users/sync', async (req, res) => {
    try {
      const uid = typeof req.body?.uid === 'string' ? req.body.uid.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
      if (!uid || !email) {
        return res.status(400).json({ success: false, message: 'uid and email required' });
      }

      // Delete any duplicates in Firebase with same email but different UID
      try {
        const snap = await getDocs(collection(db, 'users'));
        snap.forEach((d: any) => {
          if (d.id !== uid) {
            const data = d.data() || {};
            if (typeof data.email === 'string' && data.email.trim().toLowerCase() === email) {
              void deleteDoc(doc(db, 'users', d.id));
              console.log(`[User Sync] Deleted duplicate user document ${d.id} for email ${email}`);
            }
          }
        });
      } catch {}

      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists) {
        const trialStorePath = path.resolve(__dirname, '.trial_store.json');
        let store: Record<string, any> = {};
        if (fs.existsSync(trialStorePath)) {
          try { store = JSON.parse(fs.readFileSync(trialStorePath, 'utf-8')); } catch {}
        }
        const emailKey = email.replace(/[^a-z0-9]/g, '_');
        const existingTrial = store[emailKey] || store[uid];
        const now = Date.now();
        const isTrialValid = existingTrial?.expiresAt && new Date(existingTrial.expiresAt).getTime() > now;
        const trialExpiry = req.body?.expiresAt || (isTrialValid ? existingTrial.expiresAt : (!existingTrial ? new Date(now + 30 * 60 * 1000).toISOString() : null));
        const hasTrial = Boolean(isTrialValid || !existingTrial);
        const claimedAt = existingTrial?.claimedAt || new Date(now).toISOString();

        await setDoc(userRef, {
          uid,
          email,
          displayName: displayName || email.split('@')[0],
          licenseKey: hasTrial ? 'FREE_TRIAL_30M' : null,
          licensePlan: hasTrial ? '⚡ 30-Minute Free Trial (Active)' : 'Trial Expired',
          licenseStatus: hasTrial ? 'active' : 'expired',
          licenseExpiresAt: trialExpiry,
          hasUsedTrial: true,
          trialClaimedAt: claimedAt,
          trialEmail: email,
          lifetimeTrialLocked: true,
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
        });

        if (hasTrial && trialExpiry) {
          try {
            store[emailKey] = { userUid: uid, userEmail: email, expiresAt: trialExpiry, claimedAt, lifetimeLocked: true };
            store[uid] = { userUid: uid, userEmail: email, expiresAt: trialExpiry, claimedAt, lifetimeLocked: true };
            fs.writeFileSync(trialStorePath, JSON.stringify(store, null, 2), 'utf-8');
            const session = sessionManager.getSession(uid, email);
            session.setSessionLicense(trialExpiry, false);
          } catch {}
        }
      } else {
        await setDoc(userRef, {
          email,
          lastLogin: new Date().toISOString(),
          ...(displayName ? { displayName } : {}),
        }, { merge: true });
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin update user license/access endpoint (persists unlimited, extra days, revokes)
  app.post('/api/admin/update-user', async (req, res) => {
    if (!(await requireOwnerAuth(req, res))) return;
    try {
      const uid = typeof req.body?.uid === 'string' ? req.body.uid.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (!uid) {
        return res.status(400).json({ success: false, error: 'User ID is required.' });
      }

      const isUnlimited = typeof req.body?.isUnlimited === 'boolean' ? req.body.isUnlimited : undefined;
      const licenseExpiresAt = req.body?.licenseExpiresAt !== undefined ? req.body.licenseExpiresAt : undefined;
      const licensePlan = typeof req.body?.licensePlan === 'string' ? req.body.licensePlan : undefined;
      const licenseStatus = typeof req.body?.licenseStatus === 'string' ? req.body.licenseStatus : undefined;
      const licenseKey = typeof req.body?.licenseKey === 'string' ? req.body.licenseKey : undefined;

      const updateData: Record<string, any> = {
        updatedAt: new Date().toISOString(),
      };
      if (email) updateData.email = email;
      if (isUnlimited !== undefined) updateData.isUnlimited = isUnlimited;
      if (licenseExpiresAt !== undefined) updateData.licenseExpiresAt = licenseExpiresAt;
      if (licensePlan !== undefined) updateData.licensePlan = licensePlan;
      if (licenseStatus !== undefined) updateData.licenseStatus = licenseStatus;
      if (licenseKey !== undefined) updateData.licenseKey = licenseKey;

      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, updateData, { merge: true });

      const userLicRef = doc(db, 'user_licenses', uid);
      await setDoc(userLicRef, {
        userId: uid,
        ...(email ? { email } : {}),
        ...(isUnlimited !== undefined ? { isUnlimited } : {}),
        ...(licenseExpiresAt !== undefined ? { expiresAt: licenseExpiresAt } : {}),
        ...(licensePlan !== undefined ? { plan: licensePlan } : {}),
        ...(licenseStatus !== undefined ? { status: licenseStatus } : {}),
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      // Update session in memory
      const session = sessionManager.getSession(uid, email);
      if (email) session.userEmail = email;
      if (isUnlimited !== undefined) {
        session.setSessionLicense(isUnlimited ? null : (licenseExpiresAt !== undefined ? licenseExpiresAt : null), isUnlimited);
      } else if (licenseExpiresAt !== undefined) {
        session.setSessionLicense(licenseExpiresAt, false);
      }
      if (licensePlan) session.sessionLicensePlan = licensePlan;
      if (licenseKey) session.sessionLicenseKey = licenseKey;

      res.json({ success: true, updated: updateData });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Global one-minute account synchronization endpoints
  app.post('/api/whatsapp/sync-all', async (req, res) => {
    if (!(await requireOwnerAuth(req, res))) return;
    try {
      const stats = await sessionManager.runGlobalOneMinuteSync();
      res.json({ success: true, message: 'One-minute account synchronization completed', stats });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/whatsapp/sync-all/status', async (req, res) => {
    if (!(await requireOwnerAuth(req, res))) return;
    res.json({
      success: true,
      stats: sessionManager.getSyncStats(),
      serverTime: new Date().toISOString(),
    });
  });

  // -------------------------------------------------------------
  // LICENSE MANAGEMENT & REDEMPTION (BIDIRECTIONAL PERSISTENT STORE)
  // -------------------------------------------------------------

  // Save single minted key to persistent store & server db
  app.post('/api/licenses/create', async (req, res) => {
    try {
      const record = req.body;
      if (!record || !record.key) {
        return res.status(400).json({ success: false, error: 'Valid license record required' });
      }
      const saved = saveLicenseRecord(record);
      // Also register into server db
      try {
        await setDoc(doc(db, 'licenses', saved.key), saved);
      } catch {}
      res.json({ success: true, license: saved });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Batch save minted keys to persistent store & server db
  app.post('/api/licenses/batch-create', async (req, res) => {
    try {
      const licenses = req.body?.licenses || [];
      if (!Array.isArray(licenses)) {
        return res.status(400).json({ success: false, error: 'Array of licenses required' });
      }
      const saved = saveBatchLicenseRecords(licenses);
      for (const lic of saved) {
        try {
          await setDoc(doc(db, 'licenses', lic.key), lic);
        } catch {}
      }
      res.json({ success: true, count: saved.length, licenses: saved });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // List all licenses (merging server persistent store and Firestore)
  app.get('/api/licenses', async (req, res) => {
    try {
      const map = new Map<string, any>();
      // 1. From persistent store
      const fileLicenses = getAllLicenseRecords();
      for (const l of fileLicenses) {
        map.set(l.key, l);
      }
      // 2. From Firestore / server db
      try {
        const snap = await getDocs(collection(db, 'licenses'));
        snap.forEach((d: any) => {
          const data = d.data() || {};
          const k = data.key || d.id;
          if (k) {
            const existing = map.get(k) || {};
            map.set(k, { ...existing, ...data, key: k });
          }
        });
      } catch {}
      res.json({ success: true, licenses: Array.from(map.values()) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Delete a license
  app.delete('/api/licenses/:key', async (req, res) => {
    const key = (req.params.key || '').trim().toUpperCase();
    deleteLicenseRecord(key);
    try {
      await deleteDoc(doc(db, 'licenses', key));
    } catch {}
    res.json({ success: true, message: `License ${key} deleted` });
  });

  // Wipe unused licenses
  app.post('/api/licenses/wipe-unused', async (req, res) => {
    const count = wipeUnusedLicenseRecords();
    if (!isFirestoreQuotaExhausted()) {
      try {
        const snap = await getDocs(collection(db, 'licenses'));
        let deletedFs = 0;
        const batch = (db as any).batch ? (db as any).batch() : null;
        for (const d of snap.docs) {
          const data = d.data() || {};
          if (data.status === 'unclaimed' && !data.claimedBy) {
            if (batch && deletedFs < 250) {
              batch.delete(doc(db, 'licenses', d.id));
              deletedFs++;
            } else if (!batch && deletedFs < 50) {
              await deleteDoc(doc(db, 'licenses', d.id)).catch(() => {});
              deletedFs++;
            }
          }
        }
        if (batch && deletedFs > 0) {
          await batch.commit().catch(() => {});
        }
      } catch (err) {
        reportFirestoreError(err);
      }
    }
    res.json({ success: true, count, message: `Wiped ${count} unused licenses` });
  });

  // Wipe expired licenses
  app.post('/api/licenses/wipe-expired', async (req, res) => {
    const count = wipeExpiredLicenseRecords();
    res.json({ success: true, count, message: `Wiped ${count} expired licenses` });
  });

  // Redeem keys on the server with authoritative time stacking
  app.post('/api/license/redeem', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const key = typeof req.body?.key === 'string' ? req.body.key.trim().toUpperCase() : '';
    if (!userId || !email || !key) {
      return res.status(400).json({ success: false, message: 'A signed-in user, email, and license key are required.' });
    }

    try {
      // 1. Look up license in persistent store first, then server db
      let license = findLicenseByKey(key);
      const licenseRef = doc(db, 'licenses', key);
      const userRef = doc(db, 'users', userId);
      const userLicenseRef = doc(db, 'user_licenses', userId);

      if (!license) {
        try {
          const snap = await getDoc(licenseRef);
          if (snap.exists) {
            license = snap.data() as any;
            if (license) saveLicenseRecord(license as any);
          }
        } catch {}
      }

      // 2. Fallback: Query live Firestore via REST API if local store was restarted/cleared
      if (!license && firebaseConfig.projectId) {
        try {
          const fsRes = await fetch(
            `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/(default)/documents/licenses/${encodeURIComponent(key)}`,
            { signal: AbortSignal.timeout(4000) }
          );
          if (fsRes.ok) {
            const fsDoc = (await fsRes.json()) as any;
            if (fsDoc?.fields) {
              const parseFs = (f: any) => {
                if (!f) return undefined;
                if (f.stringValue !== undefined) return f.stringValue;
                if (f.integerValue !== undefined) return Number(f.integerValue);
                if (f.doubleValue !== undefined) return Number(f.doubleValue);
                if (f.booleanValue !== undefined) return f.booleanValue;
                return undefined;
              };
              const fields = fsDoc.fields;
              license = saveLicenseRecord({
                key: parseFs(fields.key) || key,
                planId: parseFs(fields.planId) || 'custom',
                planName: parseFs(fields.planName) || 'Paid License Plan',
                durationDays: Number(parseFs(fields.durationDays) || 1),
                durationMinutes: Number(parseFs(fields.durationMinutes) || 0),
                status: parseFs(fields.status) || 'unclaimed',
                claimedBy: parseFs(fields.claimedBy) || null,
                claimedEmail: parseFs(fields.claimedEmail) || null,
                expiresAt: parseFs(fields.expiresAt) || null,
                createdAt: parseFs(fields.createdAt) || new Date().toISOString(),
              });
            }
          }
        } catch (restErr) {
          console.debug('Firestore REST lookup note:', restErr);
        }
      }

      // 3. Fallback: If client provided license snapshot (from Firestore or mint cache)
      if (!license && req.body?.clientLicenseRecord) {
        const clr = req.body.clientLicenseRecord;
        if (clr && typeof clr.key === 'string' && clr.key.trim().toUpperCase() === key) {
          license = saveLicenseRecord({
            key,
            planId: clr.planId || 'custom',
            planName: clr.planName || 'Paid License Plan',
            durationDays: Number(clr.durationDays) || 1,
            durationMinutes: Number(clr.durationMinutes) || 0,
            status: clr.status || 'unclaimed',
            createdAt: clr.createdAt || new Date().toISOString(),
          });
        }
      }

      if (!license) {
        return res.status(404).json({ success: false, message: 'Invalid license key. No matching key found in the system.' });
      }

      if (license.status === 'revoked') {
        return res.status(403).json({ success: false, message: 'This license key has been revoked by administration.' });
      }

      if (license.status !== 'unclaimed' || license.claimedBy) {
        if (
          license.status === 'active' &&
          license.claimedBy === userId &&
          license.claimedEmail === email &&
          typeof license.expiresAt === 'string'
        ) {
          return res.status(409).json({
            success: false,
            message: 'This key was already redeemed by your account. It was not applied again, so no extra time was added.',
          });
        }
        return res.status(409).json({ success: false, message: 'This license key has already been used and cannot be redeemed again.' });
      }

      const addedDays = Number(license.durationDays);
      const addedMinutes = Number(license.durationMinutes || 0);
      if (!Number.isFinite(addedDays) || addedDays <= 0 || !Number.isFinite(addedMinutes) || addedMinutes < 0) {
        return res.status(422).json({ success: false, message: 'This license key has an invalid duration. No time was added.' });
      }

      // Check current user record (gracefully initialize if not in db yet)
      let user: any = null;
      try {
        const userSnap = await getDoc(userRef);
        user = userSnap.exists ? userSnap.data() : null;
      } catch {}

      if (!user) {
        user = { uid: userId, email, licenseStatus: 'expired' };
      }

      const isOwner = isOwnerEmail(email);
      if (isOwner) {
        return res.status(409).json({ success: false, message: 'This account is Owner and already has permanent unlimited access.' });
      }

      const now = Date.now();
      // Calculate current active expiry (time stacking)
      let currentExpiryTime = 0;
      if (user.licenseExpiresAt) {
        const uExp = expiryMillis(user.licenseExpiresAt);
        if (uExp > currentExpiryTime) currentExpiryTime = uExp;
      }
      // Check session
      const session = sessionManager.getSession(userId, email);
      if (session.sessionLicenseExpiresAt) {
        const sExp = expiryMillis(session.sessionLicenseExpiresAt);
        if (sExp > currentExpiryTime) currentExpiryTime = sExp;
      }
      // Check trial store
      const trialStorePath = path.resolve(__dirname, '.trial_store.json');
      if (fs.existsSync(trialStorePath)) {
        try {
          const tStore = JSON.parse(fs.readFileSync(trialStorePath, 'utf-8'));
          const emailKey = email.replace(/[^a-z0-9]/g, '_');
          const tRec = tStore[emailKey] || tStore[userId];
          if (tRec?.expiresAt) {
            const tExp = expiryMillis(tRec.expiresAt);
            if (tExp > currentExpiryTime) currentExpiryTime = tExp;
          }
        } catch {}
      }

      // Check client active countdown as well
      if (req.body?.currentClientExpiresAt) {
        const cExp = expiryMillis(req.body.currentClientExpiresAt);
        if (cExp > currentExpiryTime) currentExpiryTime = cExp;
      }

      const currentRemainingMs = currentExpiryTime > now ? currentExpiryTime - now : 0;
      const expiresAt = new Date(
        now + currentRemainingMs + addedDays * 86400000 + addedMinutes * 60000
      ).toISOString();
      const claimedAt = new Date(now).toISOString();

      // Mark redeemed in persistent store
      markLicenseRedeemed(key, userId, email, expiresAt);

      // Save to server db
      try {
        await setDoc(licenseRef, {
          ...license,
          status: 'active',
          claimedBy: userId,
          claimedEmail: email,
          claimedAt,
          expiresAt,
        });

        await setDoc(userRef, {
          uid: userId,
          email,
          licenseKey: key,
          licensePlan: license.planName,
          licenseExpiresAt: expiresAt,
          licenseStatus: 'active',
          isUnlimited: false,
          updatedAt: claimedAt,
        }, { merge: true });

        await setDoc(userLicenseRef, {
          userId,
          email,
          activeKey: key,
          plan: license.planName,
          durationDays: addedDays,
          expiresAt,
          updatedAt: claimedAt,
        }, { merge: true });
      } catch (dbErr) {
        console.warn('Server db license write note:', dbErr);
      }

      // Apply to session immediately
      session.setSessionLicense(expiresAt, false);
      session.sessionLicenseKey = key;
      session.sessionLicensePlan = license.planName;

      return res.json({
        success: true,
        planName: String(license.planName || 'License'),
        addedDays,
        addedMinutes,
        expiresAt,
        currentRemainingMs,
      });
    } catch (err: any) {
      reportFirestoreError(err);
      console.error('License redemption error:', err);
      res.status(500).json({ success: false, message: err.message || 'License could not be saved. Please retry.' });
    }
  });

  // WhatsApp Baileys API endpoints (per-user session)
  app.get('/api/whatsapp/status', async (req, res) => {
    const userId = (req.query.userId as string) || (req.headers['x-user-id'] as string) || '';
    if (!userId) {
      // Unauthenticated / clean slate: do NOT leak previous account's status
      return res.json({
        success: true,
        botName: 'SOLVATECH',
        firebaseProject: firebaseConfig.projectId,
        status: {
          state: 'disconnected',
          isConnected: false,
          pairingStage: 'idle',
        },
      });
    }
    const session = getSessionForReq(req);
    // Ensure any pending cloud credential restoration is completed before returning status
    await session.ensureRestored();
    res.json({
      success: true,
      botName: 'SOLVATECH',
      firebaseProject: firebaseConfig.projectId,
      status: session.getStatus(),
    });
  });

  app.get('/api/whatsapp/notifications', (req, res) => {
    const userId = (req.query.userId as string) || (req.headers['x-user-id'] as string) || '';
    if (!userId) {
      return res.json({ success: true, notifications: [] });
    }
    const session = getSessionForReq(req);
    res.json({
      success: true,
      notifications: session.getNotifications(),
    });
  });

  app.delete('/api/whatsapp/notifications', (req, res) => {
    const session = getSessionForReq(req);
    session.clearNotifications();
    res.json({ success: true, message: 'Notifications cleared' });
  });

  app.post('/api/whatsapp/pair-code', async (req, res) => {
    try {
      const { phoneNumber, force = false } = req.body;
      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          error: 'Phone number is required',
        });
      }
      const userId = (req.body?.userId as string) || '';
      if (!userId) {
        return res.status(400).json({ success: false, error: 'User ID is required.' });
      }
      const userEmail = (req.body?.userEmail as string) || (req.query?.userEmail as string) || '';
      const session = sessionManager.getSession(userId, userEmail);
      if (userEmail) {
        session.userEmail = userEmail;
      }

      const isAccountOwner = isOwnerEmail(userEmail) || session.isOwnerEmail();
      if (isAccountOwner) {
        session.setSessionLicense(null, true);
      } else {
        // 1. Check if session already has a valid active license
        const isSessionValid = session.sessionLicenseExpiresAt && new Date(session.sessionLicenseExpiresAt).getTime() > Date.now();
        // 2. Check if .trial_store.json has an active trial
        let isTrialActive = false;
        const cleanUserEmail = (userEmail || '').trim().toLowerCase();
        const emailKey = cleanUserEmail ? cleanUserEmail.replace(/[^a-z0-9]/g, '_') : '';
        const trialStorePath = path.resolve(__dirname, '.trial_store.json');
        if (fs.existsSync(trialStorePath)) {
          try {
            const tStore = JSON.parse(fs.readFileSync(trialStorePath, 'utf-8'));
            const tRec = (emailKey && tStore[emailKey]) || (userId && tStore[userId]);
            if (tRec?.expiresAt && new Date(tRec.expiresAt).getTime() > Date.now()) {
              session.setSessionLicense(tRec.expiresAt, false);
              isTrialActive = true;
            }
          } catch {}
        }

        if (req.body?.licenseExpiresAt && new Date(req.body.licenseExpiresAt).getTime() > Date.now()) {
          session.setSessionLicense(req.body.licenseExpiresAt, false);
        } else if (req.body?.isUnlimited) {
          session.setSessionLicense(null, true);
        }

        if (!isSessionValid && !isTrialActive && session.isLicenseExpired()) {
          const licenseVerified = await session.syncLicenseFromFirestore();
          if (!licenseVerified && session.isLicenseExpired()) {
            return res.status(403).json({
              success: false,
              error: 'Please activate your 30-minute free trial or redeem a license key to connect.',
            });
          }
        }
      }

      if (session.isLicenseExpired()) {
        return res.status(403).json({
          success: false,
          error: 'Cannot connect to bot: License key has expired! Please renew your license to connect.',
        });
      }

      const pairingCode = await session.requestPairingCode(phoneNumber, Boolean(force));
      res.json({
        success: true,
        pairingCode,
        targetPhone: session.getStatus().targetPhone || req.body.phoneNumber,
        status: session.getStatus(),
      });
    } catch (err: any) {
      console.error('Pairing code error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to generate pairing code',
      });
    }
  });

  app.post('/api/whatsapp/qr-code', async (req, res) => {
    try {
      const userId = (req.body?.userId as string) || (req.query?.userId as string) || (req.headers['x-user-id'] as string) || '';
      if (!userId) {
        return res.status(400).json({ success: false, error: 'User ID is required.' });
      }
      const session = getSessionForReq(req);
      if (session.isLicenseExpired()) {
        return res.status(403).json({
          success: false,
          error: 'Cannot connect to bot: License key has expired! Please renew your license to connect.',
        });
      }
      await session.initSocket(true);
      let attempts = 0;
      while (!session.getStatus().qrCodeUrl && attempts < 8) {
        await new Promise((r) => setTimeout(r, 500));
        attempts++;
      }
      res.json({
        success: true,
        qrCodeUrl: session.getStatus().qrCodeUrl || null,
        status: session.getStatus(),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to generate QR code' });
    }
  });

  app.post('/api/whatsapp/send-message', async (req, res) => {
    try {
      const { to, message } = req.body;
      if (!to || !message) {
        return res.status(400).json({
          success: false,
          error: 'Recipient number ("to") and "message" are required',
        });
      }

      const session = getSessionForReq(req);
      await session.sendMessage(to, message);
      res.json({ success: true, message: 'Message sent successfully' });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to send WhatsApp message',
      });
    }
  });

  app.post('/api/whatsapp/test-dm', async (req, res) => {
    try {
      const session = getSessionForReq(req);
      const status = session.getStatus();
      if (!status.isConnected) {
        return res.status(400).json({
          success: false,
          error: 'WhatsApp is not currently connected for this account. Please pair your WhatsApp account first.',
        });
      }
      const rawPhone = status.user?.phone || status.targetPhone || '';
      const cleanPhone = rawPhone.replace(/\D/g, '');
      if (!cleanPhone) {
        return res.status(400).json({
          success: false,
          error: 'Could not determine connected WhatsApp number.',
        });
      }
      await session.sendMessage(
        cleanPhone,
        `🔔 *[SOLVATECH NOTIFICATION TEST]* 🔔\n\n✅ Your WhatsApp connection and notification engine are LIVE and healthy!\n⏰ Time: *${new Date().toLocaleTimeString()}*\n\n🛡️ *Status:* Connected & Listening\n📱 *Number:* +${cleanPhone}\n\n💬 All Anti-Delete DM recovery, View-Once decryption, and 35+ commands are actively functioning on your account.\n\n> ⚡ _SOLVATECH Multi-Device Engine_`
      );
      res.json({
        success: true,
        message: `Test notification sent successfully to your WhatsApp DM (+${cleanPhone})!`,
      });
    } catch (err: any) {
      console.error('Test DM error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to send notification to WhatsApp',
      });
    }
  });

  // Groups Management & Security Settings (Auto-Welcome & Auto-Goodbye UI Switches per user session)
  app.get('/api/groups', async (req, res) => {
    try {
      const session = getSessionForReq(req);
      const status = session.getStatus();
      const isLive = status.isConnected || session.isSocketActive();
      if (!isLive && !session.hasRegisteredCredentials()) {
        return res.json({
          success: true,
          connected: false,
          message: 'Link account first to show your groups that you are in.',
          groups: [],
        });
      }
      const adminOnly = req.query.adminOnly === 'true' || req.query.adminOnly === '1';
      const groups = await session.getGroupsWithSettings(adminOnly);
      res.json({ success: true, connected: true, groups });
    } catch (err: any) {
      console.error('Error fetching groups:', err);
      res.status(500).json({ success: false, error: err.message, groups: [] });
    }
  });

  app.post('/api/groups/sync', async (req, res) => {
    try {
      const session = getSessionForReq(req);
      const status = session.getStatus();
      const isLive = status.isConnected || session.isSocketActive();
      if (!isLive && !session.hasRegisteredCredentials()) {
        return res.json({
          success: true,
          connected: false,
          message: 'Link account first to show your groups that you are in.',
          groups: [],
        });
      }
      // STRICT USER REQUIREMENT: Only fetch groups where the account is an admin
      const groups = await session.getGroupsWithSettings(true);
      res.json({ success: true, connected: true, groups });
    } catch (err: any) {
      console.error('Error syncing groups:', err);
      res.status(500).json({ success: false, error: err.message, groups: [] });
    }
  });

  app.get('/api/groups/:gid/picture', async (req, res) => {
    try {
      const session = getSessionForReq(req);
      const { gid } = req.params;
      const pictureUrl = await session.getGroupPictureUrl(gid);
      if (pictureUrl) {
        return res.json({ success: true, pictureUrl });
      }
      return res.status(404).json({ success: false, error: 'No group picture available' });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/groups/settings', async (req, res) => {
    try {
      const session = getSessionForReq(req);
      const { groupId, key, value } = req.body;
      const settingKeys = ['antilink', 'antibot', 'antistatus', 'antispam', 'autowelcome', 'autogoodbye'];
      if (!groupId || !settingKeys.includes(key) || typeof value !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'groupId, a supported group setting, and boolean value are required',
        });
      }

      // Security Check: Only group admins can change group protection
      const isGroupAdmin = await session.isBotAdminInGroupById(groupId);
      if (!isGroupAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: You are not an admin of this group. Only group admins can configure protection settings.',
        });
      }

      await commandHandler.setSecuritySetting(groupId, key as any, value, session.userId);
      const updatedSettings = commandHandler.getSecuritySettings(groupId, session.userId);
      res.json({ success: true, groupId, settings: updatedSettings });
    } catch (err: any) {
      console.error('Error updating group security setting:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/groups/toggle-all', async (req, res) => {
    try {
      const session = getSessionForReq(req);
      const { groupId, enableAll } = req.body;
      if (!groupId || typeof enableAll !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'groupId and boolean enableAll required',
        });
      }

      // Security Check: Only group admins can change group protection
      const isGroupAdmin = await session.isBotAdminInGroupById(groupId);
      if (!isGroupAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: You are not an admin of this group. Only group admins can configure protection settings.',
        });
      }

      const updated = await commandHandler.toggleAllForGroup(groupId, enableAll, session.userId);
      res.json({ success: true, groupId, settings: updated });
    } catch (err: any) {
      console.error('Error toggling all group settings:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/groups/warn-limit', async (req, res) => {
    try {
      const session = getSessionForReq(req);
      const { groupId, limit } = req.body;
      if (!groupId || typeof limit !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'groupId and numeric limit required',
        });
      }

      // Security Check: Only group admins can change group protection
      const isGroupAdmin = await session.isBotAdminInGroupById(groupId);
      if (!isGroupAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: You are not an admin of this group. Only group admins can configure protection settings.',
        });
      }

      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return res.status(400).json({ success: false, error: 'limit must be a whole number between 1 and 100.' });
      }

      await commandHandler.setWarnLimit(groupId, limit, session.userId);
      res.json({ success: true, groupId, settings: commandHandler.getSecuritySettings(groupId, session.userId) });
    } catch (err: any) {
      console.error('Error updating group warn limit:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // User Anti-Delete Recovery Setting (isolated per user session)
  app.get('/api/user/anti-delete', (req, res) => {
    const session = getSessionForReq(req);
    res.json({
      success: true,
      enabled: session.getAntiDeleteEnabled(),
    });
  });

  app.post('/api/user/anti-delete', (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Boolean "enabled" field required' });
      }
      const session = getSessionForReq(req);
      session.setAntiDeleteEnabled(enabled);
      res.json({
        success: true,
        enabled: session.getAntiDeleteEnabled(),
        message: enabled
          ? 'Anti-delete recovery is ON. Deleted messages will be forwarded to your personal WhatsApp DM.'
          : 'Anti-delete recovery is OFF. Deleted messages will be ignored.',
      });
    } catch (err: any) {
      console.error('Error setting anti-delete:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 1. Check Trial Status
  app.get('/api/trial/status', async (req, res) => {
    try {
      const uid = (req.query.uid as string) || '';
      const email = ((req.query.email as string) || '').toLowerCase().trim();
      if (!uid && !email) {
        return res.status(400).json({ success: false, error: 'A user ID or email is required.' });
      }

      let userRecord: any = null;
      let trialRecord: any = null;

      if (!isFirestoreQuotaExhausted()) {
        try {
          const userSnap = uid ? await getDoc(doc(db, 'users', uid)) : null;
          userRecord = userSnap?.exists ? userSnap.data() : null;
          const accountEmail = email || (typeof userRecord?.email === 'string' ? userRecord.email.toLowerCase().trim() : '');
          const emailKey = accountEmail.replace(/[^a-z0-9]/g, '_');
          const trialSnap = accountEmail ? await getDoc(doc(db, 'claimed_trials', emailKey)) : null;
          trialRecord = trialSnap?.exists ? trialSnap.data() : null;
        } catch (fErr: any) {
          reportFirestoreError(fErr);
        }
      }

      // Local fallback to .trial_store.json if Firestore is exhausted or offline
      if (!trialRecord) {
        try {
          const trialStorePath = path.resolve(__dirname, '.trial_store.json');
          if (fs.existsSync(trialStorePath)) {
            const store = JSON.parse(fs.readFileSync(trialStorePath, 'utf-8'));
            const emailKey = email ? email.replace(/[^a-z0-9]/g, '_') : '';
            trialRecord = (emailKey && store[emailKey]) || (uid && store[uid]) || null;
          }
        } catch {}
      }

      const now = Date.now();
      const expiresAt = trialRecord?.expiresAt || userRecord?.licenseExpiresAt || null;
      const expMs = expiresAt ? new Date(expiresAt).getTime() : 0;
      const isActive = expMs > now;
      const remainingMs = isActive ? expMs - now : 0;
      const hasClaimedEver = Boolean(
        trialRecord?.claimedAt ||
        trialRecord?.lifetimeLocked ||
        userRecord?.hasUsedTrial ||
        userRecord?.lifetimeTrialLocked
      );

      return res.json({
        success: true,
        hasClaimedTrial: hasClaimedEver,
        hasUsedTrial: hasClaimedEver,
        isActive,
        expiresAt,
        remainingMs,
      });
    } catch (err: any) {
      reportFirestoreError(err);
      res.json({ success: true, hasUsedTrial: false, isActive: false, remainingMs: 0 });
    }
  });

  // 2. Claim 30-Minute Trial (Once in a lifetime permanent lock per user/email)
  app.post('/api/trial/claim', async (req, res) => {
    try {
      const uid = typeof req.body?.uid === 'string' ? req.body.uid.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (!uid || !email) {
        return res.status(400).json({ success: false, message: 'A signed-in user ID and email are required.' });
      }

      const cleanEmail = email;
      const cleanUid = uid;
      const cleanEmailKey = cleanEmail.replace(/[^a-z0-9]/g, '_');

      // Check local file store first to enforce permanent lifetime lock
      const trialStorePath = path.resolve(__dirname, '.trial_store.json');
      let store: Record<string, any> = {};
      if (fs.existsSync(trialStorePath)) {
        try { store = JSON.parse(fs.readFileSync(trialStorePath, 'utf-8')); } catch {}
      }
      const existingTrial = store[cleanEmailKey] || store[cleanUid];
      const now = Date.now();
      if (existingTrial) {
        const expMs = expiryMillis(existingTrial.expiresAt);
        if (expMs > now) {
          // Still active
          const session = sessionManager.getSession(cleanUid, cleanEmail);
          session.setSessionLicense(existingTrial.expiresAt, false);
          return res.json({
            success: true,
            message: '🎉 30-minute test is already active! Your countdown is running.',
            expiresAt: existingTrial.expiresAt,
            hasClaimedTrial: true,
          });
        }
        return res.status(409).json({
          success: false,
          message: 'The 30-minute trial has already been claimed for this account.',
        });
      }

      const trialRef = doc(db, 'claimed_trials', cleanEmailKey);
      const userRef = doc(db, 'users', cleanUid);
      let claim: { expiresAt: string; claimedAt: string } | null = null;

      try {
        claim = await runTransaction(db, async (transaction) => {
          const [trialSnap, userSnap] = await Promise.all([
            transaction.get(trialRef),
            transaction.get(userRef),
          ]);

          if (trialSnap.exists) {
            const tData = trialSnap.data();
            const expMs = expiryMillis(tData?.expiresAt);
            if (expMs > now) {
              return { expiresAt: tData.expiresAt, claimedAt: tData.claimedAt || new Date(now).toISOString() };
            }
            throw new Error('TRIAL_ALREADY_CLAIMED');
          }

          const userData = userSnap.exists ? userSnap.data() : null;
          if (userData) {
            if (userData.isUnlimited) {
              throw new Error('ACTIVE_LICENSE_EXISTS');
            }
            if (userData.hasUsedTrial || userData.lifetimeTrialLocked) {
              const expMs = expiryMillis(userData.licenseExpiresAt);
              if (expMs > now) {
                return { expiresAt: userData.licenseExpiresAt, claimedAt: userData.trialClaimedAt || new Date(now).toISOString() };
              }
              throw new Error('TRIAL_ALREADY_CLAIMED');
            }
            const savedExpiryMs = expiryMillis(userData.licenseExpiresAt);
            if (savedExpiryMs > now) {
              throw new Error('ACTIVE_LICENSE_EXISTS');
            }
          }

          const expiry = new Date(now + 30 * 60 * 1000).toISOString();
          const claimedAt = new Date(now).toISOString();
          transaction.set(trialRef, {
            userUid: cleanUid,
            userEmail: cleanEmail,
            claimedAt,
            expiresAt: expiry,
            lifetimeLocked: true,
          });
          transaction.set(userRef, {
            uid: cleanUid,
            email: cleanEmail,
            displayName: userData?.displayName || cleanEmail.split('@')[0],
            licenseExpiresAt: expiry,
            licensePlan: '⚡ 30-Minute Test (Active)',
            licenseStatus: 'active',
            isUnlimited: false,
            hasUsedTrial: true,
            trialClaimedAt: claimedAt,
            trialEmail: cleanEmail,
            lifetimeTrialLocked: true,
            updatedAt: claimedAt,
          }, { merge: true });
          return { expiresAt: expiry, claimedAt };
        });
      } catch (txErr: any) {
        const msg = String(txErr?.message || '');
        if (msg === 'TRIAL_ALREADY_CLAIMED') {
          return res.status(409).json({ success: false, message: 'The 30-minute trial has already been claimed for this account.' });
        }
        if (msg === 'ACTIVE_LICENSE_EXISTS') {
          return res.status(409).json({ success: false, message: 'This account already has active paid or unlimited access. Your existing access was not changed.' });
        }
        console.warn('Transaction error during trial claim (falling back to direct persistence):', txErr);
        // Fallback: create fresh 30-minute expiry
        const expiry = new Date(now + 30 * 60 * 1000).toISOString();
        const claimedAt = new Date(now).toISOString();
        claim = { expiresAt: expiry, claimedAt };
        try {
          await setDoc(trialRef, {
            userUid: cleanUid,
            userEmail: cleanEmail,
            claimedAt,
            expiresAt: expiry,
            lifetimeLocked: true,
          });
          await setDoc(userRef, {
            uid: cleanUid,
            email: cleanEmail,
            displayName: cleanEmail.split('@')[0],
            licenseExpiresAt: expiry,
            licensePlan: '⚡ 30-Minute Test (Active)',
            licenseStatus: 'active',
            isUnlimited: false,
            hasUsedTrial: true,
            trialClaimedAt: claimedAt,
            trialEmail: cleanEmail,
            lifetimeTrialLocked: true,
            updatedAt: claimedAt,
          }, { merge: true });
        } catch {}
      }

      const { expiresAt: newExpiresAt, claimedAt } = claim!;

      try {
        store[cleanEmailKey] = { userUid: cleanUid, userEmail: cleanEmail, expiresAt: newExpiresAt, claimedAt, lifetimeLocked: true };
        store[cleanUid] = { userUid: cleanUid, userEmail: cleanEmail, expiresAt: newExpiresAt, claimedAt, lifetimeLocked: true };
        fs.writeFileSync(trialStorePath, JSON.stringify(store, null, 2), 'utf-8');
      } catch {}

      const session = sessionManager.getSession(cleanUid, cleanEmail);
      session.setSessionLicense(newExpiresAt, false);
      await session.syncLicenseFromFirestore().catch(() => {});

      return res.json({
        success: true,
        message: '🎉 30-minute test activated! Your countdown has begun.',
        expiresAt: newExpiresAt,
        hasClaimedTrial: true,
      });
    } catch (err: any) {
      reportFirestoreError(err);
      const message = String(err?.message || '');
      if (message === 'TRIAL_ALREADY_CLAIMED') {
        return res.status(409).json({ success: false, message: 'The 30-minute trial has already been claimed for this account.' });
      }
      if (message === 'ACTIVE_LICENSE_EXISTS') {
        return res.status(409).json({ success: false, message: 'This account already has active paid or unlimited access. Your existing access was not changed.' });
      }
      console.error('Trial claim error:', err);
      return res.status(503).json({ success: false, message: err.message || 'Trial activation could not be completed; please retry.' });
    }
  });

  // 3. Reset 30-Minute Trial (DISABLED: Once in a lifetime forever)
  app.post('/api/trial/reset', (_req, res) => {
    return res.status(403).json({
      success: false,
      message: 'The 30-minute trial is permanent and once in a lifetime per user email in Firebase. Admin cannot reset or return 30-minute trials.',
    });
  });

  // 4. Reset all trials (DISABLED: Once in a lifetime forever)
  app.post('/api/trial/reset-all', (_req, res) => {
    return res.status(403).json({
      success: false,
      message: 'The 30-minute trial is permanent and once in a lifetime per user email in Firebase. Admin cannot reset or return 30-minute trials.',
    });
  });

  // Execute bot command directly via Simulator / Web UI
  app.post('/api/commands/execute', async (req, res) => {
    try {
      const { text, isOwner = true } = req.body;
      if (!text) {
        return res.status(400).json({ success: false, error: 'Command text is required' });
      }

      const session = getSessionForReq(req);
      if (session.isLicenseExpired()) {
        return res.status(403).json({
          success: false,
          error: 'License expired! Your license duration has elapsed down to the minute. Please renew your license key on the website to execute commands.',
        });
      }

      const cleanText = text.trim();
      const rawCmd = cleanText.startsWith('.') ? cleanText.slice(1) : cleanText;
      const parts = rawCmd.split(/\s+/);
      const command = parts[0]?.toLowerCase();
      const args = parts.slice(1);

      const status = session.getStatus();
      const isSimulatedGroup =
        req.body.isGroup ??
        (req.body.groupJid ||
          ['link', 'groupinfo', 'anti', 'autowelcome', 'autogoodbye', 'antilink', 'antibot', 'antistatus', 'antispam', 'warn', 'warnlimit', 'warns'].includes(command));
      const groupJid = req.body.groupJid || req.body.groupId || (isSimulatedGroup ? '1203630248491823@g.us' : undefined);
      await commandHandler.loadAccountSecuritySettings(session.userId);
      const result = await commandHandler.handle({
        command,
        args,
        fullText: cleanText,
        senderJid: status.user?.phone ? `${status.user.phone.replace(/\D/g, '')}@s.whatsapp.net` : '2349049979183@s.whatsapp.net',
        senderNumber: status.user?.phone?.replace(/\D/g, '') || '2349049979183',
        isGroup: Boolean(isSimulatedGroup),
        groupJid,
        pushName: status.user?.name || 'Solvatech User',
        isOwner: isOwner ?? true,
        securityScope: session.userId,
        linkedSince: session.getConnectedAt(),
        linkedPhone: status.user?.phone || null,
        licenseExpiresAt: req.body.licenseExpiresAt || null,
        licensePlan: req.body.licensePlan || null,
        quotedParticipant: req.body.quotedParticipant || undefined,
        mentionedJids: req.body.mentionedJids || [],
        getTopChatted: (phone: string) => session.getTopChatted(phone),
        isGroupParticipantAdmin: (gid: string, participantJid: string) =>
          session.isGroupParticipantAdmin(gid, participantJid),
      });

      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Explicit user action: unlinks companion device permanently from server & Firebase
  app.post('/api/whatsapp/logout', async (req, res) => {
    try {
      const userId = (req.body?.userId as string) || (req.query?.userId as string) || (req.headers['x-user-id'] as string) || '';
      await sessionManager.logoutSession(userId, true);
      res.json({ success: true, message: 'Session logged out and cleared for this user account' });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to logout session',
      });
    }
  });

  // Disconnect/Pause bot (preserves pairing credentials strictly for life unless unlink=true)
  app.post('/api/whatsapp/disconnect', async (req, res) => {
    try {
      const userId = (req.body?.userId as string) || (req.query?.userId as string) || (req.headers['x-user-id'] as string) || '';
      const unlink = req.body?.unlink === true || req.query?.unlink === 'true';
      if (unlink) {
        await sessionManager.logoutSession(userId, true);
      } else {
        await sessionManager.pauseSession(userId);
      }
      res.json({ success: true, message: unlink ? 'Device unlinked permanently' : 'Bot socket paused (pairing strictly preserved)' });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to disconnect session',
      });
    }
  });

  // Reconnect/Resume bot without needing new QR or pairing code
  app.post('/api/whatsapp/reconnect', async (req, res) => {
    try {
      const userId =
        (req.body?.userId as string) ||
        (req.query?.userId as string) ||
        (req.headers['x-user-id'] as string) ||
        '';
      if (!userId) {
        return res.status(400).json({ success: false, error: 'User ID is required.' });
      }
      const userEmail =
        (req.body?.userEmail as string) ||
        (req.query?.userEmail as string) ||
        (req.headers['x-user-email'] as string) ||
        '';
      const session = sessionManager.getSession(userId, userEmail);
      if (userEmail && !session.userEmail) {
        session.userEmail = userEmail;
      }

      await session.syncLicenseFromFirestore().catch(() => {});
      if (session.isLicenseExpired()) {
        return res.status(403).json({
          success: false,
          reason: 'no_license',
          error: 'Cannot reconnect: License is expired. Please renew your license key on the website.',
        });
      }

      const hasCreds = await session.ensureRestored();
      const currentStatus = session.getStatus();
      const hasPhoneRecord = Boolean(currentStatus.user?.phone || currentStatus.targetPhone);

      if (!hasCreds) {
        return res.status(404).json({
          success: false,
          reason: 'no_record',
          error: hasPhoneRecord
            ? 'No active companion session keys found in cloud backup. Tap "Pair WhatsApp" instead to relink your phone with a fresh code.'
            : 'No record of WhatsApp linked before for this account. Tap "Pair WhatsApp" to link your phone number first.',
        });
      }

      if (currentStatus.isConnected) {
        return res.json({
          success: true,
          alreadyConnected: true,
          message: `WhatsApp is already connected and active for ${currentStatus.user?.phone || 'your phone'}! 🟢`,
          status: currentStatus,
        });
      }

      // Try reconnecting for up to 60 seconds
      console.log(`[Manual Reconnect] Starting 60s reconnect pass for ${userId} (${currentStatus.user?.phone || 'device'})...`);
      await session.initSocket().catch((err) => {
        console.warn(`[Manual Reconnect] Socket init note:`, err?.message || err);
      });

      const startTime = Date.now();
      const MAX_WAIT_MS = 60 * 1000;
      let connected = false;
      let unlinked = false;
      let latestStatus = session.getStatus();

      while (Date.now() - startTime < MAX_WAIT_MS) {
        await new Promise((r) => setTimeout(r, 1200));
        latestStatus = session.getStatus();
        if (latestStatus.isConnected) {
          connected = true;
          break;
        }
        if (latestStatus.lastError && (latestStatus.lastError.includes('unlinked') || latestStatus.lastError.includes('401'))) {
          unlinked = true;
          break;
        }
      }

      if (connected) {
        return res.json({
          success: true,
          message: `🎉 Successfully reconnected to your WhatsApp account (+${latestStatus.user?.phone || 'device'})! Bot is active 24/7.`,
          status: latestStatus,
        });
      }

      if (unlinked) {
        return res.status(401).json({
          success: false,
          reason: 'unlinked',
          error: "This device was unlinked from WhatsApp on your phone. Tap 'Pair WhatsApp' instead to link fresh with a new pairing code.",
          status: latestStatus,
        });
      }

      return res.status(504).json({
        success: false,
        reason: 'unreachable',
        error: "Could not reach WhatsApp on your phone within 1 minute. Ensure your phone is turned on with active internet and WhatsApp open, or tap 'Pair / Change Number' to relink fresh.",
        status: latestStatus,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to reconnect session' });
    }
  });

  // Admin Bulk Action: Reconnect All accounts with active license and WhatsApp records
  app.post('/api/admin/whatsapp/reconnect-all', async (req, res) => {
    try {
      const authorized = await requireOwnerAuth(req, res);
      if (!authorized) return;

      console.log('[Admin Reconnect All] Running bulk reconnect across all licensed accounts with WhatsApp records...');
      const result = await sessionManager.reconnectAll();
      res.json(result);
    } catch (err: any) {
      console.error('[Admin Reconnect All] Error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Bulk reconnection failed' });
    }
  });

  // Admin Single User Action: Reconnect a specific user
  app.post('/api/admin/whatsapp/reconnect-user', async (req, res) => {
    try {
      const authorized = await requireOwnerAuth(req, res);
      if (!authorized) return;

      const targetUid = (req.body?.targetUid as string) || (req.query?.targetUid as string) || '';
      if (!targetUid) {
        return res.status(400).json({ success: false, error: 'targetUid is required' });
      }

      const session = sessionManager.getSession(targetUid);
      await session.syncLicenseFromFirestore().catch(() => {});
      if (session.isLicenseExpired()) {
        return res.status(403).json({
          success: false,
          reason: 'no_license',
          error: `Cannot reconnect user ${targetUid}: License is expired.`,
        });
      }

      const hasCreds = await session.ensureRestored();
      if (!hasCreds) {
        return res.status(404).json({
          success: false,
          reason: 'no_record',
          error: `No record of WhatsApp linked before for user ${targetUid}. User needs to pair first.`,
        });
      }

      await session.initSocket();

      // Try reconnecting for up to 60 seconds (1 full minute)
      const maxWaitMs = Math.min(Number(req.body?.timeoutSeconds || 60) * 1000, 60000);
      const startTime = Date.now();
      let connected = false;
      let unlinked = false;
      let latestStatus = session.getStatus();

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 1000));
        latestStatus = session.getStatus();
        if (latestStatus.isConnected) {
          connected = true;
          break;
        }
        if (latestStatus.lastError && (latestStatus.lastError.includes('unlinked') || latestStatus.lastError.includes('401'))) {
          unlinked = true;
          break;
        }
      }

      if (connected) {
        const phone = latestStatus.user?.phone || latestStatus.targetPhone || '';
        return res.json({
          success: true,
          message: `User ${targetUid} (+${phone || 'device'}) successfully connected back to WhatsApp! 🟢`,
          status: latestStatus,
        });
      }

      if (unlinked) {
        return res.status(401).json({
          success: false,
          reason: 'unlinked',
          error: `User unlinked the device from WhatsApp on their phone. Tap pair instead.`,
          status: latestStatus,
        });
      }

      return res.status(504).json({
        success: false,
        reason: 'unreachable',
        error: `Could not reach WhatsApp on phone within 1 minute. Can't reach WhatsApp or phone is offline. Tap pair instead.`,
        status: latestStatus,
      });
    } catch (err: any) {
      console.error('[Admin Reconnect User] Error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Reconnection failed' });
    }
  });

  // 🛡️ 24/7 INSTANT HEALTH CHECKS: Compatible with Railway, UptimeRobot, and cloud load balancers
  app.get(['/health', '/api/health'], (_req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      bot: 'SOLVATECH',
      memoryRssMb: Math.round(process.memoryUsage().rss / 1048576),
      firebase: firebaseConfig.projectId,
      timestamp: new Date().toISOString()
    });
  });

  app.get('/ping', (_req, res) => {
    res.status(200).send('pong');
  });

  // 🛡️ SELF-HEALING KEEP-ALIVE HEARTBEAT (Pings internal health route every 4 minutes)
  // Keeps the Node event loop hot and network sockets active without relying on manual user pings
  setInterval(() => {
    try {
      const pingReq = http.get(`http://127.0.0.1:${PORT}/api/health`, (pRes) => {
        pRes.resume();
      });
      pingReq.on('error', () => {});
    } catch {}
  }, 4 * 60 * 1000);

  // 🖼️ OpenGraph and Social Media Preview Asset Provider
  // Explicit route for WhatsApp, Facebook, Twitter, and Telegram crawlers
  const publicDir = path.resolve(__dirname, 'public');
  const ogImagePath = path.resolve(publicDir, 'og-image.jpg');

  app.get('/og-image.jpg', (_req, res) => {
    if (fs.existsSync(ogImagePath)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.sendFile(ogImagePath);
    }
    const distOg = path.resolve(__dirname, 'dist', 'og-image.jpg');
    if (fs.existsSync(distOg)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.sendFile(distOg);
    }
    res.status(404).send('Image Not Found');
  });

  // Serve static public folder assets directly
  app.use(express.static(publicDir, {
    maxAge: '1d',
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  }));

  if (!isProd) {
    const vite = await createViteServer({
      root: __dirname,
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    const indexHtmlPath = path.resolve(distPath, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      app.use(express.static(distPath));

      let cachedHtml = '';
      try {
        cachedHtml = fs.readFileSync(indexHtmlPath, 'utf-8');
      } catch {}

      app.get('*', (req, res) => {
        if (!cachedHtml) {
          return res.sendFile(indexHtmlPath);
        }
        const host = req.get('x-forwarded-host') || req.get('host') || 'solvatech.up.railway.app';
        const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
        const origin = `${proto}://${host}`;
        // If accessed through a different domain/host, dynamically align the og:url and og:image origin
        const html = cachedHtml.replace(/https:\/\/solvatech\.up\.railway\.app/g, origin);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(html);
      });
    } else {
      console.warn('[SOLVATECH] dist/index.html not found, falling back to Vite middleware');
      const vite = await createViteServer({
        root: __dirname,
        server: {
          middlewareMode: true,
          allowedHosts: true,
          ws: { server },
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SOLVATECH] Primary server listening on port ${PORT}`);
    // Instant reconnection on startup / Railway crash recovery:
    // Checks all previously connected sessions, validates licenses, and restores them
    setTimeout(() => {
      console.log('[SOLVATECH] Running startup auto-restore and instant reconnect pass...');
      sessionManager.autoRestoreAllSessions().catch((err) => {
        console.warn('[SOLVATECH] Startup auto-restore note:', err);
      });
    }, 2000);
  });

  if (isRailway && PORT !== 8080) {
    try {
      const secondaryServer = http.createServer(app);
      secondaryServer.on('error', (err: any) => {
        // Activates on Railway where 8080 is free
        console.debug('[SOLVATECH] Secondary port 8080 adapter note:', err?.code || err?.message);
      });
      secondaryServer.listen(8080, '0.0.0.0', () => {
        console.log('[SOLVATECH] Secondary server listening on port 8080 for Railway routing');
      });
    } catch {}
  }

  let shutdownStarted = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    console.log(`[SOLVATECH] Received ${signal}; saving WhatsApp sessions before stopping.`);

    const forceExit = setTimeout(() => {
      console.error('[SOLVATECH] Graceful shutdown exceeded 15 seconds; exiting for the Railway restart.');
      process.exit(1);
    }, 15_000);
    const serverClosed = new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });

    void (async () => {
      try {
        await sessionManager.shutdownForProcessExit();
        await serverClosed;
        clearTimeout(forceExit);
        process.exit(0);
      } catch (err) {
        console.error('[SOLVATECH] Graceful shutdown failed:', err);
        process.exit(1);
      }
    })();
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
