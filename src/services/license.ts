import { auth, db, isFirestoreQuotaExhausted, reportFirestoreError } from './firebase.ts';
import { OWNER_EMAIL, OWNER_EMAILS, isOwnerEmail } from './admin-config.ts';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  getDocsFromServer,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  query,
  where,
  orderBy
} from 'firebase/firestore';

export interface LicensePlan {
  id: string;
  name: string;
  durationDays: number;
  durationMinutes?: number;
  priceNgn: number;
  priceFormatted: string;
}

export const LICENSE_PLANS: LicensePlan[] = [
  { id: '1d', name: '1 Day', durationDays: 1, priceNgn: 200, priceFormatted: '₦200' },
  { id: '2d', name: '2 Days', durationDays: 2, priceNgn: 400, priceFormatted: '₦400' },
  { id: '3d', name: '3 Days', durationDays: 3, priceNgn: 500, priceFormatted: '₦500' },
  { id: '5d', name: '5 Days (Special)', durationDays: 5, priceNgn: 750, priceFormatted: '₦750' },
  { id: '7d', name: '7 Days', durationDays: 7, priceNgn: 1000, priceFormatted: '₦1,000' },
  { id: '14d', name: '14 Days / 2 Weeks', durationDays: 14, priceNgn: 2000, priceFormatted: '₦2,000' },
  { id: '30d', name: '30 Days', durationDays: 30, priceNgn: 4000, priceFormatted: '₦4,000' },
  { id: '2m', name: '2 Months', durationDays: 60, priceNgn: 8000, priceFormatted: '₦8,000' },
  { id: '3m', name: '3 Months', durationDays: 90, priceNgn: 12000, priceFormatted: '₦12,000' },
  { id: '6m', name: '6 Months', durationDays: 180, priceNgn: 24000, priceFormatted: '₦24,000' },
  { id: '12m', name: '12 Months', durationDays: 365, priceNgn: 48000, priceFormatted: '₦48,000' },
];

export const PAYMENT_INFO = {
  bank: 'OPay',
  accountNumber: '9049979183',
  accountName: 'SOLOMON OLADIMEJI',
  phone: '9049979183',
  whatsappLink: 'https://wa.me/2349049979183?text=Hello%20Solomon,%20I%20have%20paid%20for%20my%20SOLVATECH%20license.%20Here%20is%20my%20proof%20of%20payment.',
};

export interface LicenseRecord {
  key: string;
  planId: string;
  planName: string;
  durationDays: number;
  durationMinutes?: number;
  status: 'unclaimed' | 'active' | 'expired' | 'revoked';
  claimedBy?: string;
  claimedEmail?: string;
  claimedAt?: string;
  createdAt: string;
  expiresAt?: string;
  createdBy?: string;
}

export { OWNER_EMAIL, OWNER_EMAILS, isOwnerEmail };

const pendingLicenseWrites = new Map<string, LicenseRecord>();
const LICENSE_WRITE_TIMEOUT_MS = 15_000;

// STRICT SECURITY RULE: ZERO PRELOADED KEYS.
// Every single license key must be genuinely minted by the admin through the dashboard.
// There are no backdoor codes, no default keys, and no reuse permitted!

export function generateKeyString(planPrefix: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let p1 = '';
  let p2 = '';
  for (let i = 0; i < 4; i++) {
    p1 += chars.charAt(Math.floor(Math.random() * chars.length));
    p2 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `SOLVA-${planPrefix.toUpperCase()}-${p1}-${p2}`;
}

export async function createLicense(plan: LicensePlan, createdBy: string = OWNER_EMAIL): Promise<LicenseRecord> {
  const record: LicenseRecord = {
    key: generateKeyString(plan.id),
    planId: plan.id,
    planName: plan.name,
    durationDays: plan.durationDays,
    durationMinutes: plan.durationMinutes || 0,
    status: 'unclaimed',
    createdAt: new Date().toISOString(),
    createdBy,
  };

  // 1. Immediately persist on the server (authoritative backend store)
  try {
    await fetch('/api/licenses/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  } catch (srvErr) {
    console.warn('Server license write note:', srvErr);
  }

  // 2. Also save to Firestore
  if (!isFirestoreQuotaExhausted()) {
    try {
      const docRef = doc(db, 'licenses', record.key);
      await setDoc(docRef, record).catch((err) => reportFirestoreError(err));
    } catch (err) {
      reportFirestoreError(err);
      console.warn('Firestore license write:', err);
    }
  }

  return record;
}

// Redemption time and key consumption are authoritative on the server.
export async function redeemKey(
  userUid: string,
  userEmail: string,
  keyToRedeem: string
): Promise<{
  success: boolean;
  message: string;
  expiresAt?: string;
  durationAdded?: number;
  stacked?: boolean;
}> {
  if (!userUid || !userEmail || !keyToRedeem.trim()) {
    return { success: false, message: 'Sign in and enter a valid license key before redeeming.' };
  }

  const cleanKey = keyToRedeem.trim().toUpperCase().replace(/\s+/g, '');
  const cleanEmail = userEmail.trim().toLowerCase();
  const currentClientExpiresAt =
    localStorage.getItem(`solvatech_license_expiresAt_${userUid}`) ||
    localStorage.getItem(`solvatech_license_expiresAt_${cleanEmail}`) ||
    null;

  let data: any;
  try {
    let response = await fetch('/api/license/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userUid,
        email: cleanEmail,
        key: cleanKey,
        currentClientExpiresAt,
      }),
    });
    data = await response.json();

    // If server didn't find the key (e.g. minted on client or during restart), check client Firestore fallback
    if ((!response.ok || !data.success) && (response.status === 404 || data?.message?.includes('not found') || data?.message?.includes('Invalid'))) {
      try {
        const licSnap = await getDoc(doc(db, 'licenses', cleanKey));
        if (licSnap.exists()) {
          const licData = licSnap.data() as LicenseRecord;
          response = await fetch('/api/license/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: userUid,
              email: cleanEmail,
              key: cleanKey,
              currentClientExpiresAt,
              clientLicenseRecord: licData,
            }),
          });
          data = await response.json();
        }
      } catch (fallbackErr) {
        console.warn('Client Firestore fallback check note:', fallbackErr);
      }
    }

    if (!response.ok || !data.success) {
      return {
        success: false,
        message: data?.message || 'License could not be saved. No time was added; please retry.',
      };
    }
  } catch (err) {
    console.warn('License redemption service note:', err);
    return { success: false, message: 'License service is unavailable. No time was added; please retry.' };
  }

  const newExpiresAt = String(data.expiresAt);
  const addedDays = Number(data.addedDays);
  const addedMinutes = Number(data.addedMinutes || 0);
  const serverRemainingMs = Number(data.currentRemainingMs || 0);
  const currentRemainingMs = Number.isFinite(serverRemainingMs) ? Math.max(0, serverRemainingMs) : 0;
  const prevHours = Math.floor(currentRemainingMs / 3600000);
  const prevMins = Math.floor((currentRemainingMs % 3600000) / 60000);
  const totalRemainingMs =
    currentRemainingMs +
    addedDays * 24 * 60 * 60 * 1000 +
    addedMinutes * 60 * 1000;
  const newDays = Math.floor(totalRemainingMs / 86400000);
  const remHours = Math.floor((totalRemainingMs % 86400000) / 3600000);
  const remMins = Math.floor((totalRemainingMs % 3600000) / 60000);
  const isStacked = currentRemainingMs > 0;
  const addedTimeLabel = [
    addedDays > 0 ? `${addedDays} day${addedDays === 1 ? '' : 's'}` : '',
    addedMinutes > 0 ? `${addedMinutes} minute${addedMinutes === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' + ');
  const message = isStacked
    ? `🎉 ${data.planName} Activated! Added ${addedTimeLabel} on top of your existing ${prevHours}h ${prevMins}m balance. New total: ${newDays > 0 ? `${newDays}d ` : ''}${remHours}h ${remMins}m left!`
    : `🎉 ${data.planName} Activated! You have ${addedTimeLabel} of full 24/7 WhatsApp bot access. Timer is running!`;

  // Save to localStorage immediately so zero-blink countdown works
  try {
    localStorage.setItem(`solvatech_license_expiresAt_${userUid}`, newExpiresAt);
    localStorage.setItem(`solvatech_license_expiresAt_${cleanEmail}`, newExpiresAt);
  } catch {}

  // Update client Firestore user document directly for reactive UI sync
  if (!isFirestoreQuotaExhausted() && db && (db as any).app) {
    try {
      const userRef = doc(db, 'users', userUid);
      setDoc(userRef, {
        uid: userUid,
        email: cleanEmail,
        licenseExpiresAt: newExpiresAt,
        licensePlan: data.planName || 'Active Paid Plan',
        licenseKey: cleanKey,
        licenseStatus: 'active',
        isUnlimited: false,
        updatedAt: serverTimestamp(),
      }, { merge: true }).catch((err) => reportFirestoreError(err));

      const userLicRef = doc(db, 'user_licenses', userUid);
      setDoc(userLicRef, {
        userId: userUid,
        email: cleanEmail,
        activeKey: cleanKey,
        plan: data.planName || 'Active Paid Plan',
        expiresAt: newExpiresAt,
        updatedAt: serverTimestamp(),
      }, { merge: true }).catch((err) => reportFirestoreError(err));
    } catch (e) {
      reportFirestoreError(e);
    }
  }

  // Trigger server session license sync
  try {
    void fetch('/api/whatsapp/sync-license', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userUid,
        userEmail: cleanEmail,
        expiresAt: newExpiresAt,
        isUnlimited: false,
      }),
    });
  } catch {}

  return {
    success: true,
    message,
    expiresAt: newExpiresAt,
    durationAdded: addedDays,
    stacked: isStacked,
  };
}

async function postAdminUpdate(payload: Record<string, any>): Promise<void> {
  try {
    const idToken = await auth?.currentUser?.getIdToken().catch(() => '');
    const userEmail = auth?.currentUser?.email || OWNER_EMAIL;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-user-email': userEmail,
    };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    await fetch('/api/admin/update-user', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.debug('postAdminUpdate note:', err);
  }
}

// TOGGLE UNLIMITED ACCESS FOR ANY USER (ADMIN QUICK SWITCH)
export async function toggleUserUnlimited(
  userUid: string,
  userEmail: string,
  enableUnlimited: boolean
): Promise<boolean> {
  const email = userEmail || `${userUid}@solvatech.com`;
  
  // STRICT RULE: Owner accounts CAN NEVER be removed from unlimited!
  if (isOwnerEmail(email)) {
    enableUnlimited = true;
    return true;
  }

  if (!isFirestoreQuotaExhausted() && db && (db as any).app) {
    try {
      const userRef = doc(db, 'users', userUid);
      await setDoc(
        userRef,
        {
          uid: userUid,
          email,
          isUnlimited: enableUnlimited,
          licenseStatus: enableUnlimited ? 'unlimited' : 'expired',
          licensePlan: enableUnlimited ? '👑 Unlimited Lifetime (Admin Granted)' : 'Expired Plan',
          licenseKey: enableUnlimited ? 'SOLVA-ADMIN-UNLIMITED-VIP' : 'REVOKED',
          licenseExpiresAt: enableUnlimited ? null : new Date().toISOString(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch((err) => reportFirestoreError(err));

      const userLicRef = doc(db, 'user_licenses', userUid);
      await setDoc(
        userLicRef,
        {
          userId: userUid,
          email,
          isUnlimited: enableUnlimited,
          status: enableUnlimited ? 'unlimited' : 'expired',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch((err) => reportFirestoreError(err));

      // Sync any secondary Firestore records with the same email
      if (email && email.includes('@')) {
        try {
          const qSnap = await getDocs(query(collection(db, 'users'), where('email', '==', email.trim().toLowerCase())));
          for (const d of qSnap.docs) {
            if (d.id !== userUid) {
              await setDoc(
                doc(db, 'users', d.id),
                {
                  isUnlimited: enableUnlimited,
                  licenseStatus: enableUnlimited ? 'unlimited' : 'expired',
                  licensePlan: enableUnlimited ? '👑 Unlimited Lifetime (Admin Granted)' : 'Expired Plan',
                  licenseKey: enableUnlimited ? 'SOLVA-ADMIN-UNLIMITED-VIP' : 'REVOKED',
                  licenseExpiresAt: enableUnlimited ? null : new Date().toISOString(),
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              ).catch((err) => reportFirestoreError(err));
            }
          }
        } catch (subErr) {
          reportFirestoreError(subErr);
        }
      }
    } catch (err) {
      reportFirestoreError(err);
      console.warn('Firestore toggle unlimited:', err);
    }
  }

  try {
    localStorage.setItem(`solvatech_license_isUnlimited_${userUid}`, enableUnlimited ? 'true' : 'false');
    if (email) {
      localStorage.setItem(`solvatech_license_isUnlimited_${email.trim().toLowerCase()}`, enableUnlimited ? 'true' : 'false');
    }
  } catch {}

  // Persist directly to backend database so refresh never loses state
  await postAdminUpdate({
    uid: userUid,
    email,
    isUnlimited: enableUnlimited,
    licenseExpiresAt: enableUnlimited ? null : new Date().toISOString(),
    licensePlan: enableUnlimited ? '👑 Unlimited Lifetime (Admin Granted)' : 'Expired Plan',
    licenseStatus: enableUnlimited ? 'unlimited' : 'expired',
    licenseKey: enableUnlimited ? 'SOLVA-ADMIN-UNLIMITED-VIP' : 'REVOKED',
  });

  try {
    await fetch('/api/whatsapp/sync-license', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userUid,
        userEmail: email,
        expiresAt: enableUnlimited ? null : new Date().toISOString(),
        isUnlimited: enableUnlimited,
      }),
    });
  } catch {}

  return enableUnlimited;
}

// Grant or Revoke Unlimited by email/identifier directly
export async function grantUserUnlimitedByIdentifier(
  identifier: string,
  enable: boolean = true
): Promise<{ success: boolean; user: any }> {
  const clean = identifier.trim().toLowerCase();
  const uid = clean.replace(/[^a-zA-Z0-9]/g, '_');
  await toggleUserUnlimited(uid, clean, enable);

  return {
    success: true,
    user: {
      uid,
      email: clean,
      displayName: clean.split('@')[0],
      isUnlimited: enable,
      licensePlan: enable ? '👑 Unlimited Lifetime (Admin Granted)' : 'Expired Plan',
      licenseStatus: enable ? 'unlimited' : 'expired',
    },
  };
}

// Grant extra days (+1D, +7D, +30D) to any user with stacking
export async function grantUserExtraDays(
  userUid: string,
  userEmail: string,
  days: number
): Promise<{ success: boolean; expiresAt: string; message: string }> {
  let currentExpiryTime = 0;
  try {
    const userRef = doc(db, 'users', userUid);
    const snap = await getDoc(userRef);
    if (snap.exists() && snap.data()?.licenseExpiresAt) {
      const parsed = new Date(snap.data().licenseExpiresAt).getTime();
      if (parsed > Date.now()) {
        currentExpiryTime = parsed;
      }
    }
  } catch (err) {
    console.warn('Firestore read extra days note:', err);
  }

  const now = Date.now();
  const baseTime = currentExpiryTime > now ? currentExpiryTime : now;
  const newExpiryMs = baseTime + days * 24 * 60 * 60 * 1000;
  const newExpiresAt = new Date(newExpiryMs).toISOString();

  if (!isFirestoreQuotaExhausted() && db && (db as any).app) {
    try {
      const userRef = doc(db, 'users', userUid);
      await setDoc(
        userRef,
        {
          uid: userUid,
          email: userEmail,
          licenseExpiresAt: newExpiresAt,
          licensePlan: `Admin Granted (+${days} Days)`,
          licenseStatus: 'active',
          isUnlimited: false,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch((err) => reportFirestoreError(err));

      const userLicRef = doc(db, 'user_licenses', userUid);
      await setDoc(
        userLicRef,
        {
          userId: userUid,
          email: userEmail,
          expiresAt: newExpiresAt,
          plan: `Admin Granted (+${days} Days)`,
          status: 'active',
          isUnlimited: false,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch((err) => reportFirestoreError(err));

      if (userEmail && userEmail.includes('@')) {
        try {
          const qSnap = await getDocs(query(collection(db, 'users'), where('email', '==', userEmail.trim().toLowerCase())));
          for (const d of qSnap.docs) {
            if (d.id !== userUid) {
              await setDoc(
                doc(db, 'users', d.id),
                {
                  licenseExpiresAt: newExpiresAt,
                  licensePlan: `Admin Granted (+${days} Days)`,
                  licenseStatus: 'active',
                  isUnlimited: false,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              ).catch((err) => reportFirestoreError(err));
            }
          }
        } catch (subErr) {
          reportFirestoreError(subErr);
        }
      }
    } catch (e) {
      reportFirestoreError(e);
      console.error('Error granting extra days in Firestore:', e);
    }
  }

  // Persist directly to backend database so refresh never loses state
  await postAdminUpdate({
    uid: userUid,
    email: userEmail,
    isUnlimited: false,
    licenseExpiresAt: newExpiresAt,
    licensePlan: `Admin Granted (+${days} Days)`,
    licenseStatus: 'active',
  });

  try {
    await fetch('/api/whatsapp/sync-license', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userUid,
        userEmail,
        expiresAt: newExpiresAt,
        isUnlimited: false,
      }),
    });
  } catch {}

  try {
    localStorage.setItem(`solvatech_license_expiresAt_${userUid}`, newExpiresAt);
    if (userEmail) localStorage.setItem(`solvatech_license_expiresAt_${userEmail.trim().toLowerCase()}`, newExpiresAt);
  } catch {}

  return {
    success: true,
    expiresAt: newExpiresAt,
    message: `Added +${days} days to ${userEmail}!`,
  };
}

// 30-MINUTE TRIAL IS PERMANENT ONCE IN A LIFETIME - ADMIN CANNOT RESET OR RETURN
export async function resetUserTrialStatus(
  _userUid: string,
  _userEmail?: string | null
): Promise<{ success: boolean; message: string }> {
  return {
    success: false,
    message: 'The 30-minute test is strictly once in a lifetime per user email in Firebase. Admin cannot reset or return 30-minute trials.',
  };
}

// Revoke user access / set to expired
export async function revokeUserAccess(
  userUid: string,
  userEmail?: string | null
): Promise<{ success: boolean; message: string }> {
  const nowIso = new Date().toISOString();
  if (!isFirestoreQuotaExhausted() && db && (db as any).app) {
    try {
      const userRef = doc(db, 'users', userUid);
      await setDoc(
        userRef,
        {
          licenseExpiresAt: nowIso,
          licenseStatus: 'expired',
          licensePlan: 'Revoked by Admin',
          isUnlimited: false,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch((err) => reportFirestoreError(err));
    } catch (e) {
      reportFirestoreError(e);
      console.warn('Error revoking in Firestore:', e);
    }
  }

  await postAdminUpdate({
    uid: userUid,
    email: userEmail || '',
    isUnlimited: false,
    licenseExpiresAt: nowIso,
    licensePlan: 'Revoked by Admin',
    licenseStatus: 'expired',
    licenseKey: 'REVOKED',
  });

  try {
    await fetch('/api/whatsapp/sync-license', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userUid,
        userEmail: userEmail || '',
        expiresAt: nowIso,
        isUnlimited: false,
      }),
    });
  } catch {}

  return {
    success: true,
    message: `Access revoked for ${userEmail || userUid}.`,
  };
}

// Batch mint multiple keys at once
export async function batchCreateLicenses(
  plan: LicensePlan,
  count: number,
  createdBy: string
): Promise<LicenseRecord[]> {
  const created: LicenseRecord[] = [];
  for (let i = 0; i < count; i++) {
    const lic = await createLicense(plan, createdBy);
    created.push(lic);
  }
  try {
    await fetch('/api/licenses/batch-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenses: created }),
    });
  } catch {}
  return created;
}

// Fetch all licenses from server backend store and Firestore
export async function fetchAllLicenses(): Promise<LicenseRecord[]> {
  const map = new Map<string, LicenseRecord>();

  // 1. Fetch from server backend store
  try {
    const res = await fetch('/api/licenses');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.licenses)) {
        for (const lic of data.licenses) {
          if (lic && lic.key) {
            map.set(lic.key, lic);
          }
        }
      }
    }
  } catch (e) {
    console.debug('Server licenses fetch note:', e);
  }

  // 2. Merge with Firestore
  try {
    const colRef = collection(db, 'licenses');
    const snap = await getDocs(colRef);
    snap.forEach((d) => {
      const data = d.data() || {};
      const key = data.key || d.id;
      if (key) {
        const existing = map.get(key) || {};
        map.set(key, {
          key,
          planId: data.planId || '1d',
          planName: data.planName || 'Custom Plan',
          durationDays: data.durationDays || 1,
          status: data.status || 'unclaimed',
          createdAt: data.createdAt || new Date().toISOString(),
          ...existing,
          ...data,
        } as LicenseRecord);
      }
    });
  } catch (err) {
    console.warn('Firestore fetch licenses:', err);
  }

  return Array.from(map.values());
}

// WIPE ALL UNUSED KEYS FROM SYSTEM TO CLEAR SPACE
export async function wipeAllUnusedLicenses(): Promise<{ count: number; message: string }> {
  let wipedCount = 0;

  try {
    const res = await fetch('/api/licenses/wipe-unused', { method: 'POST' });
    if (res.ok) {
      const d = await res.json();
      wipedCount = d.count || 0;
    }
  } catch (err) {
    console.warn('Server wipe unused licenses note:', err);
  }

  return {
    count: wipedCount,
    message: `Wiped unused license keys from system. Space cleared!`,
  };
}

// WIPE ALL EXPIRED KEYS FROM SYSTEM TO CLEAR SPACE
export async function wipeAllExpiredLicenses(): Promise<{ count: number; message: string }> {
  let wipedCount = 0;

  try {
    const res = await fetch('/api/licenses/wipe-expired', { method: 'POST' });
    if (res.ok) {
      const d = await res.json();
      wipedCount = d.count || 0;
    }
  } catch (err) {
    console.warn('Server wipe expired licenses note:', err);
  }

  return {
    count: wipedCount,
    message: `Wiped expired license keys from system. Space cleared!`,
  };
}

// DELETE A SINGLE SPECIFIC LICENSE KEY
export async function deleteSingleLicense(key: string): Promise<{ success: boolean; message: string }> {
  try {
    await fetch(`/api/licenses/${encodeURIComponent(key)}`, { method: 'DELETE' });
  } catch {}

  try {
    await deleteDoc(doc(db, 'licenses', key));
  } catch (e) {
    console.warn('Firestore single license delete warning:', e);
  }

  return {
    success: true,
    message: `License key ${key} deleted successfully.`,
  };
}

// Fetch all registered users for admin with comprehensive state coverage
// Fetch all registered users for admin with accurate real-time state coverage
export async function fetchAllUsers(): Promise<any[]> {
  const usersMap = new Map<string, any>();
  let serverStatuses: Record<string, any> = {};

  // Query live multi-user WhatsApp sessions from the server (graceful enhancement)
  try {
    const idToken = await auth?.currentUser?.getIdToken();
    const userEmail = auth?.currentUser?.email || '';
    if (idToken || userEmail) {
      const headers: Record<string, string> = {};
      if (idToken) headers.Authorization = `Bearer ${idToken}`;
      if (userEmail) headers['x-user-email'] = userEmail;
      const res = await fetch('/api/admin/users-status', { headers });
      if (res.ok) {
        const data = await res.json();
        if (data?.success && data.statuses && typeof data.statuses === 'object') {
          serverStatuses = data.statuses;
        }
      }
    }
  } catch (err) {
    console.debug('Could not fetch server live user statuses (using cached state):', err);
  }

  const now = Date.now();

  // 1. Fetch from Firestore users collection
  try {
    const colRef = collection(db, 'users');
    let snap: any;
    try {
      snap = await getDocs(colRef);
    } catch {
      snap = null;
    }
    if (snap) {
      snap.forEach((d: any) => {
        const data = d.data() || {};
        const uid = d.id;
        const isOwner = isOwnerEmail(data.email);
        const rawExpiresAt = data.licenseExpiresAt || null;
        const expMs = rawExpiresAt ? new Date(rawExpiresAt).getTime() : 0;
        // Strict countdown: if user has a finite expiration timestamp and is not owner, evaluate exact expiration
        const isUnlimited = isOwner || Boolean(data.isUnlimited) || data.licenseStatus === 'unlimited' || Boolean(data.licensePlan?.includes('Unlimited'));
        const isDateExpired = !isOwner && !isUnlimited && (
          (rawExpiresAt && expMs > 0 && expMs <= now) ||
          (!rawExpiresAt)
        );
        const isExpired = !isUnlimited && (isDateExpired || data.licenseStatus === 'expired');

        const cleanEmail = (data.email || '').trim().toLowerCase();
        const liveStatus =
          serverStatuses[uid] ||
          (cleanEmail ? serverStatuses[cleanEmail] : null) ||
          serverStatuses[`session_${uid}`] ||
          {};
        // Online check: live socket connected or persisted connected flag if not expired
        const isActuallyConnected = !isExpired && Boolean(
          liveStatus.isConnected ??
          (data.whatsappConnected || data.botConnected || data.connectionState === 'connected')
        );
        const linkedPhone = liveStatus.phone || data.linkedPhone || data.phone || null;
        const isPaired = Boolean(liveStatus.isPaired || linkedPhone);

        usersMap.set(uid, {
          uid,
          email: data.email || `${uid}@solvatech.com`,
          displayName: data.displayName || data.email?.split('@')[0] || 'Solvatech User',
          isUnlimited,
          licensePlan: isUnlimited
            ? '👑 Unlimited Lifetime (Admin Granted)'
            : (isExpired ? 'Expired Plan' : (data.licensePlan || 'Active Plan')),
          licenseStatus: isUnlimited ? 'unlimited' : (isExpired ? 'expired' : 'active'),
          licenseKey: data.licenseKey || null,
          licenseExpiresAt: isUnlimited ? null : rawExpiresAt,
          linkedPhone,
          isPaired,
          whatsappConnected: isActuallyConnected,
          hasUsedTrial: Boolean(data.hasUsedTrial),
          trialClaimedAt: data.trialClaimedAt || null,
          commandsRun: data.commandsRun || 0,
          lastLogin: data.lastLogin || data.updatedAt || new Date().toISOString(),
          memberSince: data.createdAt || '2026-10-01',
        });
      });
    }
  } catch (err) {
    console.warn('Firestore fetch users note:', err);
  }

  // 2. Query the server-side /api/admin/users and merge
  try {
    const idToken = await auth?.currentUser?.getIdToken();
    const userEmail = auth?.currentUser?.email || '';
    const headers: Record<string, string> = {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
    };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    if (userEmail) headers['x-user-email'] = userEmail;
    const res = await fetch(`/api/admin/users?_t=${Date.now()}`, { headers });
    if (res.ok) {
      const data = await res.json();
      if (data?.success && Array.isArray(data.users)) {
        for (const d of data.users) {
          const uid = d.uid;
          const isOwner = isOwnerEmail(d.email);
          const existing = usersMap.get(uid);

          // Unlimited status is retained if set in either database
          const isUnlimited = isOwner || Boolean(d.isUnlimited) || Boolean(existing?.isUnlimited) || d.licenseStatus === 'unlimited' || existing?.licenseStatus === 'unlimited' || Boolean(d.licensePlan?.includes('Unlimited')) || Boolean(existing?.licensePlan?.includes('Unlimited'));

          let finalExpiresAt: string | null = null;
          if (!isUnlimited) {
            const expExisting = existing?.licenseExpiresAt ? new Date(existing.licenseExpiresAt).getTime() : 0;
            const expServer = d.licenseExpiresAt ? new Date(d.licenseExpiresAt).getTime() : 0;
            if (expExisting > now && expExisting >= expServer) {
              finalExpiresAt = existing.licenseExpiresAt;
            } else if (expServer > now) {
              finalExpiresAt = d.licenseExpiresAt;
            } else {
              finalExpiresAt = existing?.licenseExpiresAt || d.licenseExpiresAt || null;
            }
          }

          const expMs = finalExpiresAt ? new Date(finalExpiresAt).getTime() : 0;
          const isDateExpired = !isOwner && !isUnlimited && (
            (finalExpiresAt && expMs > 0 && expMs <= now) ||
            (!finalExpiresAt)
          );
          const isExpired = !isUnlimited && isDateExpired;

          const cleanEmail = (d.email || existing?.email || '').trim().toLowerCase();
          const liveStatus =
            serverStatuses[uid] ||
            (cleanEmail ? serverStatuses[cleanEmail] : null) ||
            serverStatuses[`session_${uid}`] ||
            {};
          const isActuallyConnected = !isExpired && Boolean(
            liveStatus.isConnected ??
            (d.whatsappConnected || d.botConnected || d.connectionState === 'connected' || existing?.whatsappConnected)
          );
          const linkedPhone = liveStatus.phone || d.linkedPhone || d.phone || existing?.linkedPhone || null;
          const isPaired = Boolean(liveStatus.isPaired || linkedPhone || existing?.isPaired);

          usersMap.set(uid, {
            ...existing,
            uid,
            email: d.email || existing?.email || `${uid}@solvatech.com`,
            displayName: d.displayName || existing?.displayName || d.email?.split('@')[0] || (isOwner ? 'Admin Master' : 'Solvatech User'),
            isUnlimited,
            licensePlan: isUnlimited
              ? '👑 Unlimited Lifetime (Admin Granted)'
              : (isExpired ? 'Expired Plan' : (d.licensePlan || existing?.licensePlan || 'Active Plan')),
            licenseStatus: isUnlimited ? 'unlimited' : (isExpired ? 'expired' : 'active'),
            licenseKey: d.licenseKey || existing?.licenseKey || null,
            licenseExpiresAt: isUnlimited ? null : finalExpiresAt,
            linkedPhone,
            isPaired,
            whatsappConnected: isActuallyConnected,
            hasUsedTrial: Boolean(d.hasUsedTrial || existing?.hasUsedTrial),
            trialClaimedAt: d.trialClaimedAt || existing?.trialClaimedAt || null,
            commandsRun: d.commandsRun || existing?.commandsRun || 0,
            lastLogin: d.lastLogin || existing?.lastLogin || d.updatedAt || new Date().toISOString(),
            memberSince: d.createdAt || existing?.memberSince || '2026-10-01',
          });
        }
      }
    }
  } catch (apiErr) {
    console.debug('Backend admin users fetch note:', apiErr);
  }

  // 3. Deduplicate strictly by normalized email; delete duplicates in Firebase so only one remains
  const finalEmailMap = new Map<string, any>();
  const duplicateUidsToDelete: string[] = [];

  for (const user of usersMap.values()) {
    const rawEmail = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    if (!rawEmail) {
      finalEmailMap.set(user.uid, user);
      continue;
    }

    if (finalEmailMap.has(rawEmail)) {
      const existing = finalEmailMap.get(rawEmail);
      const isUnlimitedMerged = Boolean(existing.isUnlimited || user.isUnlimited);
      const existingScore = (existing.isUnlimited ? 100 : 0) + (existing.linkedPhone ? 50 : 0) + (existing.licenseExpiresAt ? 25 : 0);
      const currentScore = (user.isUnlimited ? 100 : 0) + (user.linkedPhone ? 50 : 0) + (user.licenseExpiresAt ? 25 : 0);

      const winner = currentScore > existingScore ? user : existing;
      const loser = currentScore > existingScore ? existing : user;

      if (loser.uid && loser.uid !== winner.uid) {
        duplicateUidsToDelete.push(loser.uid);
      }

      finalEmailMap.set(rawEmail, {
        ...winner,
        isUnlimited: isUnlimitedMerged,
        licensePlan: isUnlimitedMerged ? '👑 Unlimited Lifetime (Admin Granted)' : winner.licensePlan,
        licenseStatus: isUnlimitedMerged ? 'unlimited' : winner.licenseStatus,
        licenseExpiresAt: isUnlimitedMerged ? null : (winner.licenseExpiresAt || loser.licenseExpiresAt || null),
      });
    } else {
      finalEmailMap.set(rawEmail, user);
    }
  }

  // Delete duplicate documents from Firebase so only one remains!
  for (const dupUid of duplicateUidsToDelete) {
    try {
      void deleteDoc(doc(db, 'users', dupUid));
    } catch {}
  }

  // Ensure ONLY awoyinfasolomon1@gmail.com is granted owner unlimited master access
  const resultUsers = Array.from(finalEmailMap.values()).map((u) => {
    const isOwner = isOwnerEmail(u.email);
    if (isOwner) {
      return {
        ...u,
        isUnlimited: true,
        licensePlan: '👑 Unlimited Lifetime Master Access',
        licenseStatus: 'unlimited',
      };
    }
    return u;
  });

  return resultUsers;
}

// Countdown time calculator down to exact days, hours, minutes, seconds
export function calculateRemainingTime(expiresAt?: string | null, isUnlimited?: boolean, now = Date.now()): {
  isUnlimited: boolean;
  isExpired: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  formatted: string;
} {
  if (isUnlimited) {
    return {
      isUnlimited: true,
      isExpired: false,
      days: 9999,
      hours: 0,
      minutes: 0,
      seconds: 0,
      formatted: '👑 UNLIMITED LIFETIME ACCESS',
    };
  }

  if (!expiresAt) {
    return {
      isUnlimited: false,
      isExpired: true,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      formatted: 'NO KEY (EXPIRED)',
    };
  }

  const diffMs = new Date(expiresAt).getTime() - now;
  if (diffMs <= 0) {
    return {
      isUnlimited: false,
      isExpired: true,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      formatted: 'EXPIRED (RENEW KEY)',
    };
  }

  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((diffMs % (60 * 1000)) / 1000);

  let formatted = '';
  if (days > 0) formatted += `${days}d `;
  if (hours > 0 || days > 0) formatted += `${hours}h `;
  formatted += `${minutes}m ${seconds}s left`;

  return {
    isUnlimited: false,
    isExpired: false,
    days,
    hours,
    minutes,
    seconds,
    formatted,
  };
}

// 30-MINUTE TEST SYSTEM — SERVER-AUTHORITATIVE & LIFETIME LOCK PER ACCOUNT IN FIREBASE
export async function checkUserTrialStatus(
  userUid: string,
  userEmail?: string | null
): Promise<boolean> {
  if (!userUid && !userEmail) return false;

  const cleanEmail = (userEmail || '').trim().toLowerCase();

  // Instant local memory check: once claimed in this account, never show again
  try {
    if (userUid && localStorage.getItem(`solvatech_trial_claimed_${userUid}`) === 'true') {
      return true;
    }
    if (cleanEmail && localStorage.getItem(`solvatech_trial_claimed_${cleanEmail}`) === 'true') {
      return true;
    }
  } catch {}

  // 1. Check persistent server trial endpoint first (authoritative)
  try {
    const q = new URLSearchParams();
    if (userUid) q.set('uid', userUid);
    if (cleanEmail) q.set('email', cleanEmail);
    const res = await fetch(`/api/trial/status?${q.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        const isClaimed = Boolean(data.hasClaimedTrial ?? data.hasUsedTrial);
        if (isClaimed) {
          try {
            if (userUid) localStorage.setItem(`solvatech_trial_claimed_${userUid}`, 'true');
            if (cleanEmail) localStorage.setItem(`solvatech_trial_claimed_${cleanEmail}`, 'true');
          } catch {}
          return true;
        }
      }
    }
  } catch (apiErr) {
    console.debug('Server trial status check note:', apiErr);
  }

  // 2. Client-side fallback if server was unreachable
  if (!isFirestoreQuotaExhausted()) {
    if (userUid) {
      try {
        const userRef = doc(db, 'users', userUid);
        const snap = await getDoc(userRef);
        if (snap.exists()) {
          const data = snap.data();
          if (data?.hasUsedTrial === true || data?.trialClaimedAt || data?.lifetimeTrialLocked === true) {
            try {
              localStorage.setItem(`solvatech_trial_claimed_${userUid}`, 'true');
              if (cleanEmail) localStorage.setItem(`solvatech_trial_claimed_${cleanEmail}`, 'true');
            } catch {}
            return true;
          }
        }
      } catch (e: any) {
        reportFirestoreError(e);
      }
    }
  }

  return false;
}

export async function claim30MinuteTrial(
  userUid: string,
  userEmail: string
): Promise<{ success: boolean; message: string; expiresAt?: string }> {
  if (!userUid || !userEmail) {
    return {
      success: false,
      message: 'You must be signed in with your account to activate the 30-minute test.',
    };
  }

  const cleanEmail = userEmail.trim().toLowerCase();

  let finalExpiresAt: string;
  try {
    const res = await fetch('/api/trial/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: userUid,
        email: cleanEmail,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success || typeof data.expiresAt !== 'string') {
      if (data?.message?.includes('already been claimed') || data?.message?.includes('already active')) {
        try {
          localStorage.setItem(`solvatech_trial_claimed_${userUid}`, 'true');
          localStorage.setItem(`solvatech_trial_claimed_${cleanEmail}`, 'true');
        } catch {}
      }
      return {
        success: false,
        message: data?.message || 'The 30-minute test could not be activated.',
      };
    }
    finalExpiresAt = data.expiresAt;
  } catch (apiErr) {
    console.debug('Backend trial claim network note:', apiErr);
    return {
      success: false,
      message: 'Trial service is unavailable. Please retry in a moment.',
    };
  }

  // Permanently save to localStorage for this account so claim banner is gone forever
  try {
    localStorage.setItem(`solvatech_trial_claimed_${userUid}`, 'true');
    localStorage.setItem(`solvatech_trial_claimed_${cleanEmail}`, 'true');
    localStorage.setItem(`solvatech_license_expiresAt_${userUid}`, finalExpiresAt);
    localStorage.setItem(`solvatech_license_expiresAt_${cleanEmail}`, finalExpiresAt);
  } catch {}

  // Update client Firestore user document directly for immediate reactive UI update
  if (!isFirestoreQuotaExhausted() && db && (db as any).app) {
    try {
      const userRef = doc(db, 'users', userUid);
      setDoc(userRef, {
        uid: userUid,
        email: cleanEmail,
        licenseExpiresAt: finalExpiresAt,
        licensePlan: '⚡ 30-Minute Test (Active)',
        licenseStatus: 'active',
        isUnlimited: false,
        hasUsedTrial: true,
        trialClaimedAt: new Date().toISOString(),
        trialEmail: cleanEmail,
        lifetimeTrialLocked: true,
      }, { merge: true }).catch((err) => reportFirestoreError(err));
    } catch (e) {
      reportFirestoreError(e);
    }
  }

  // Trigger background socket synchronization
  try {
    void fetch('/api/whatsapp/sync-license', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userUid,
        userEmail: cleanEmail,
        expiresAt: finalExpiresAt,
        isUnlimited: false,
      }),
    }).catch(() => {});
  } catch {}

  return {
    success: true,
    message: '🎉 30-minute test activated! Your countdown has begun.',
    expiresAt: finalExpiresAt,
  };
}

// TERMINATE ALL LICENSES TO EXPIRE (ADMIN ACTION)
export async function terminateAllLicenses(): Promise<{ success: boolean; count: number; message: string }> {
  let terminatedCount = 0;
  const nowIso = new Date().toISOString();

  // 1. Terminate all users in Firestore
  if (!isFirestoreQuotaExhausted() && db && (db as any).app) {
    try {
      const colRef = collection(db, 'users');
      const snap = await getDocs(colRef);
      const updates: Promise<void>[] = [];

      snap.forEach((d) => {
        const data = d.data() || {};
        const email = (data.email || '').toLowerCase();
        // Master Founder Account is NEVER terminated
        if (isOwnerEmail(email)) return;

        updates.push(
          setDoc(
            doc(db, 'users', d.id),
            {
              licenseExpiresAt: nowIso,
              licenseStatus: 'expired',
              licensePlan: 'Terminated by Admin',
              isUnlimited: false,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          ).catch((err) => reportFirestoreError(err))
        );

        updates.push(
          setDoc(
            doc(db, 'user_licenses', d.id),
            {
              expiresAt: nowIso,
              status: 'expired',
              isUnlimited: false,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          ).catch((err) => reportFirestoreError(err))
        );
        terminatedCount++;
      });

      await Promise.all(updates);
    } catch (e) {
      reportFirestoreError(e);
      console.warn('Firestore terminate all licenses warning:', e);
    }

    // 2. Also terminate active licenses in collection
    try {
      const licRef = collection(db, 'licenses');
      const licSnap = await getDocs(licRef);
      const licUpdates: Promise<void>[] = [];
      licSnap.forEach((d) => {
        const data = d.data() || {};
        if (data.status === 'active') {
          licUpdates.push(
            setDoc(
              doc(db, 'licenses', d.id),
              { status: 'expired', expiresAt: nowIso },
              { merge: true }
            ).catch((err) => reportFirestoreError(err))
          );
        }
      });
      await Promise.all(licUpdates);
    } catch (e) {
      reportFirestoreError(e);
      console.warn('Licenses collection termination note:', e);
    }
  }

  return {
    success: true,
    count: terminatedCount,
    message: `Terminated ${terminatedCount} licenses. All active accounts have been set to expired.`,
  };
}

// BATCH GRANT +7 DAYS TO ALL ACTIVE USERS (ADMIN ACTION)
export async function grantAllActiveUsersExtraDays(
  days: number = 7
): Promise<{ success: boolean; count: number; message: string }> {
  let count = 0;
  try {
    const allUsers = await fetchAllUsers();
    for (const u of allUsers) {
      if (isOwnerEmail(u.email)) continue;
      await grantUserExtraDays(u.uid, u.email, days);
      count++;
    }
  } catch (err) {
    console.warn('grantAllActiveUsersExtraDays error:', err);
  }
  return {
    success: true,
    count,
    message: `Added +${days} Days (+${days * 24}h) to ${count} users successfully!`,
  };
}


