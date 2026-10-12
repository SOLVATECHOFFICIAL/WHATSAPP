import 'dotenv/config';
import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db, doc, getDoc, runTransaction } from './src/server/firebase-admin.ts';
import { sessionManager, whatsappManager } from './src/server/whatsapp.ts';
import { commandHandler, SOLVATECH_MENU } from './src/server/commands.ts';
import {
  firebaseConfig,
} from './src/services/firebase-config.ts';
import { isFirestoreQuotaExhausted, reportFirestoreError } from './src/services/firestore-status.ts';
import { OWNER_EMAIL, isOwnerEmail } from './src/services/admin-config.ts';

// Preserve the fatal stack trace, then let Node exit so Railway can restart a
// process that may be in an unsafe state instead of continuing silently.
process.on('uncaughtExceptionMonitor', (err, origin) => {
  console.error('[SOLVATECH Fatal Process Error] Node will exit; process supervisor should restart it:', origin, err);
});

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
  const PORT = !isRailway && rawPort === 8080 ? 3000 : rawPort;
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
    if (!idToken || idToken.length > 8192) {
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

      if (!userEmail || !isOwnerEmail(userEmail)) {
        res.status(403).json({ success: false, error: 'Owner access is required.' });
        return false;
      }
      return true;
    } catch (err) {
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
      if (!userId) {
        return res.status(400).json({ success: false, error: 'User ID is required.' });
      }
      const session = sessionManager.getSession(userId);
      const verified = await session.syncLicenseFromFirestore();
      if (!verified) {
        return res.status(503).json({ success: false, error: 'Could not verify this account license from Firebase.' });
      }
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

  // Global 5-minute worldwide synchronization endpoints
  app.post('/api/whatsapp/sync-all', async (req, res) => {
    if (!(await requireOwnerAuth(req, res))) return;
    try {
      const stats = await sessionManager.runGlobal5MinSync();
      res.json({ success: true, message: 'Worldwide 5-minute synchronization completed', stats });
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

  // Redeem keys on the server so the expiry is based on server time, not the
  // browser clock, and key + account records commit atomically.
  app.post('/api/license/redeem', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const key = typeof req.body?.key === 'string' ? req.body.key.trim().toUpperCase() : '';
    if (!userId || !email || !key) {
      return res.status(400).json({ success: false, message: 'A signed-in user, email, and license key are required.' });
    }

    try {
      const result = await runTransaction(db, async (transaction) => {
        const licenseRef = doc(db, 'licenses', key);
        const userRef = doc(db, 'users', userId);
        const userLicenseRef = doc(db, 'user_licenses', userId);
        const [licenseSnap, userSnap] = await Promise.all([
          transaction.get(licenseRef),
          transaction.get(userRef),
        ]);

        if (!licenseSnap.exists) throw new Error('INVALID_KEY');
        if (!userSnap.exists) throw new Error('ACCOUNT_NOT_FOUND');
        const license = licenseSnap.data();
        const user = userSnap.data();
        const savedEmail = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
        if (savedEmail !== email) throw new Error('ACCOUNT_EMAIL_MISMATCH');
        if (license.status === 'revoked') throw new Error('KEY_REVOKED');
        if (license.status !== 'unclaimed' || license.claimedBy) {
          if (
            license.status === 'active' &&
            license.claimedBy === userId &&
            license.claimedEmail === email &&
            typeof license.expiresAt === 'string'
          ) {
            throw new Error('KEY_ALREADY_REDEEMED_BY_THIS_ACCOUNT');
          }
          throw new Error('KEY_ALREADY_USED');
        }

        const addedDays = Number(license.durationDays);
        const addedMinutes = Number(license.durationMinutes || 0);
        if (!Number.isFinite(addedDays) || addedDays <= 0 || !Number.isFinite(addedMinutes) || addedMinutes < 0) {
          throw new Error('KEY_DURATION_INVALID');
        }

        const now = Date.now();
        const currentExpiryTime = expiryMillis(user.licenseExpiresAt);
        const isOwner = isOwnerEmail(savedEmail);
        if (isOwner || (user.isUnlimited && currentExpiryTime <= now)) {
          throw new Error('ACCOUNT_UNLIMITED');
        }
        const currentRemainingMs = Number.isFinite(currentExpiryTime) && currentExpiryTime > now
          ? currentExpiryTime - now
          : 0;
        const expiresAt = new Date(
          now + currentRemainingMs + addedDays * 24 * 60 * 60 * 1000 + addedMinutes * 60 * 1000
        ).toISOString();
        const claimedAt = new Date(now).toISOString();

        transaction.set(licenseRef, {
          ...license,
          status: 'active',
          claimedBy: userId,
          claimedEmail: email,
          claimedAt,
          expiresAt,
        });
        transaction.set(userRef, {
          email,
          licenseKey: key,
          licensePlan: license.planName,
          licenseExpiresAt: expiresAt,
          licenseStatus: 'active',
          isUnlimited: false,
          updatedAt: claimedAt,
        }, { merge: true });
        transaction.set(userLicenseRef, {
          userId,
          email,
          activeKey: key,
          plan: license.planName,
          durationDays: addedDays,
          expiresAt,
          updatedAt: claimedAt,
        }, { merge: true });

        return {
          planName: String(license.planName || 'License'),
          addedDays,
          addedMinutes,
          expiresAt,
          currentRemainingMs,
        };
      });

      const session = sessionManager.getSession(userId);
      // The transaction result is authoritative. Apply it immediately so a
      // newly renewed paired device can reconnect even if a follow-up read is slow.
      session.setSessionLicense(result.expiresAt, false);
      await session.syncLicenseFromFirestore();
      res.json({ success: true, ...result });
    } catch (err: any) {
      const code = String(err?.message || '');
      if (code === 'INVALID_KEY') return res.status(404).json({ success: false, message: 'Invalid license key. No matching key found in the system.' });
      if (code === 'KEY_REVOKED') return res.status(403).json({ success: false, message: 'This license key has been revoked by administration.' });
      if (code === 'KEY_ALREADY_REDEEMED_BY_THIS_ACCOUNT') {
        return res.status(409).json({
          success: false,
          message: 'This key was already redeemed by your account. It was not applied again, so no extra time was added.',
        });
      }
      if (code === 'KEY_ALREADY_USED') return res.status(409).json({ success: false, message: 'This license key has already been used and cannot be redeemed again.' });
      if (code === 'KEY_DURATION_INVALID') return res.status(422).json({ success: false, message: 'This license key has an invalid duration. No time was added.' });
      if (code === 'ACCOUNT_UNLIMITED') return res.status(409).json({ success: false, message: 'This account already has unlimited access. Its access was not changed and the key remains unused.' });
      if (code === 'ACCOUNT_NOT_FOUND' || code === 'ACCOUNT_EMAIL_MISMATCH') return res.status(403).json({ success: false, message: 'Could not verify this signed-in account. Please sign in again.' });
      reportFirestoreError(err);
      console.error('Atomic license redemption failed:', err);
      res.status(503).json({ success: false, message: 'License could not be saved. No time was added and the key was not consumed; please retry.' });
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
        const licenseVerified = await session.syncLicenseFromFirestore();
        if (!licenseVerified) {
          if (req.body?.isUnlimited) {
            session.setSessionLicense(null, true);
          } else if (req.body?.licenseExpiresAt && new Date(req.body.licenseExpiresAt).getTime() > Date.now()) {
            session.setSessionLicense(req.body.licenseExpiresAt, false);
          } else {
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
      if (!status.isConnected) {
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
      if (!status.isConnected) {
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

      const hasUsedTrial = Boolean(
        trialRecord ||
        userRecord?.hasUsedTrial ||
        userRecord?.lifetimeTrialLocked
      );
      const expiresAt = typeof trialRecord?.expiresAt === 'string'
        ? trialRecord.expiresAt
        : (typeof userRecord?.trialClaimedAt === 'string' ? userRecord.licenseExpiresAt || null : null);
      const now = Date.now();
      const expMs = expiresAt ? new Date(expiresAt).getTime() : 0;
      const isActive = expMs > now;
      const remainingMs = isActive ? expMs - now : 0;

      return res.json({
        success: true,
        hasUsedTrial,
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

      const trialRef = doc(db, 'claimed_trials', cleanEmailKey);
      const userRef = doc(db, 'users', cleanUid);
      const claim = await runTransaction(db, async (transaction) => {
        const [trialSnap, userSnap] = await Promise.all([
          transaction.get(trialRef),
          transaction.get(userRef),
        ]);
        if (trialSnap.exists) {
          throw new Error('TRIAL_ALREADY_CLAIMED');
        }
        if (!userSnap.exists) {
          throw new Error('ACCOUNT_NOT_FOUND');
        }

        const userData = userSnap.data();
        const savedEmail = typeof userData.email === 'string' ? userData.email.trim().toLowerCase() : '';
        if (savedEmail !== cleanEmail) {
          throw new Error('ACCOUNT_EMAIL_MISMATCH');
        }
        if (userData.hasUsedTrial || userData.lifetimeTrialLocked) {
          throw new Error('TRIAL_ALREADY_CLAIMED');
        }
        const now = Date.now();
        const savedExpiryMs = expiryMillis(userData.licenseExpiresAt);
        if (userData.isUnlimited || savedExpiryMs > now) {
          throw new Error('ACTIVE_LICENSE_EXISTS');
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
      const { expiresAt: newExpiresAt, claimedAt } = claim;

      try {
        const trialStorePath = path.resolve(__dirname, '.trial_store.json');
        let store: Record<string, any> = {};
        if (fs.existsSync(trialStorePath)) {
          try { store = JSON.parse(fs.readFileSync(trialStorePath, 'utf-8')); } catch {}
        }
        store[cleanEmailKey] = { userUid: cleanUid, userEmail: cleanEmail, expiresAt: newExpiresAt, claimedAt, lifetimeLocked: true };
        store[cleanUid] = { userUid: cleanUid, userEmail: cleanEmail, expiresAt: newExpiresAt, claimedAt, lifetimeLocked: true };
        fs.writeFileSync(trialStorePath, JSON.stringify(store, null, 2), 'utf-8');
      } catch {}

      const session = sessionManager.getSession(cleanUid);
      session.setSessionLicense(newExpiresAt, false);
      await session.syncLicenseFromFirestore().catch(() => {});

      res.json({
        success: true,
        message: '🎉 30-minute test activated! Your countdown has begun.',
        expiresAt: newExpiresAt,
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
      if (message === 'ACCOUNT_NOT_FOUND' || message === 'ACCOUNT_EMAIL_MISMATCH') {
        return res.status(403).json({ success: false, message: 'Could not verify this signed-in account. Please sign in again.' });
      }
      console.error('Trial claim failed; no trial was activated:', err);
      res.status(503).json({ success: false, message: 'The trial could not be saved securely. No trial time was activated; please retry.' });
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
      const userId = (req.body?.userId as string) || '';
      if (!userId) {
        return res.status(400).json({ success: false, error: 'User ID is required.' });
      }
      const session = sessionManager.getSession(userId);
      const licenseVerified = await session.syncLicenseFromFirestore();
      if (!licenseVerified) {
        return res.status(503).json({ success: false, error: 'Could not verify this account license from Firebase.' });
      }
      if (session.isLicenseExpired()) {
        return res.status(403).json({
          success: false,
          error: 'Cannot reconnect: License is expired. Please renew your license key on the website.',
        });
      }
      await session.initSocket();
      res.json({ success: true, message: 'WhatsApp connection resumed 24/7', status: session.getStatus() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      bot: 'SOLVATECH',
      firebase: firebaseConfig.projectId,
      timestamp: new Date().toISOString()
    });
  });

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
      app.get('*', (_req, res) => {
        res.sendFile(indexHtmlPath);
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
