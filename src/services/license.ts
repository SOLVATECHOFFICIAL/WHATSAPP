import { auth, db, isFirestoreQuotaExhausted, reportFirestoreError } from './firebase';
import { OWNER_EMAIL } from './admin-config';
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
}

export { OWNER_EMAIL };

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
  const attemptId = [createdBy, plan.id, plan.name, plan.durationDays, plan.durationMinutes || 0].join(':');
  let record = pendingLicenseWrites.get(attemptId);
  if (!record) {
    record = {
      key: generateKeyString(plan.id),
      planId: plan.id,
      planName: plan.name,
      durationDays: plan.durationDays,
      status: 'unclaimed',
      createdAt: new Date().toISOString(),
    };
    pendingLicenseWrites.set(attemptId, record);
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const docRef = doc(db, 'licenses', record.key);
    await Promise.race([
      setDoc(docRef, record),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('LICENSE_SAVE_TIMEOUT')),
          LICENSE_WRITE_TIMEOUT_MS
        );
      }),
    ]);
    pendingLicenseWrites.delete(attemptId);
  } catch (err) {
    console.warn('Firestore license write:', err);
    if (err instanceof Error && err.message === 'LICENSE_SAVE_TIMEOUT') {
      throw new Error(
        'Firebase has not confirmed the save yet. Tap “Mint 1 Key” again to safely retry the same key.'
      );
    }
    pendingLicenseWrites.delete(attemptId);
    throw new Error('The license key could not be saved. No usable key was issued; please retry.');
  } finally {
    if (timeout) clearTimeout(timeout);
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

  let data: any;
  try {
    const response = await fetch('/api/license/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userUid,
        email: userEmail.trim().toLowerCase(),
        key: keyToRedeem.trim().toUpperCase(),
      }),
    });
    data = await response.json();
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

  return {
    success: true,
    message,
    expiresAt: newExpiresAt,
    durationAdded: addedDays,
    stacked: isStacked,
  };
}

// TOGGLE UNLIMITED ACCESS FOR ANY USER (ADMIN QUICK SWITCH)
export async function toggleUserUnlimited(
  userUid: string,
  userEmail: string,
  enableUnlimited: boolean
): Promise<boolean> {
  const email = userEmail || `${userUid}@solvatech.com`;
  
  // STRICT RULE: awoyinfasolomon1@gmail.com CAN NEVER be removed from unlimited!
  if (email.toLowerCase() === OWNER_EMAIL.toLowerCase()) {
    enableUnlimited = true;
    return true;
  }

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
    );

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
    );
  } catch (err) {
    console.warn('Firestore toggle unlimited:', err);
  }

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
    );
  } catch (e) {
    console.error('Error granting extra days in Firestore:', e);
  }

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
    );
  } catch (e) {
    console.warn('Error revoking in Firestore:', e);
  }

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
  return created;
}

// Fetch all licenses from Firestore and localStorage (only genuinely minted keys)
export async function fetchAllLicenses(): Promise<LicenseRecord[]> {
  const map = new Map<string, LicenseRecord>();

  try {
    const colRef = collection(db, 'licenses');
    const snap = await getDocs(colRef);
    snap.forEach((d) => {
      const data = d.data() || {};
      const key = data.key || d.id;
      if (key) {
        map.set(key, {
          key,
          planId: data.planId || '1d',
          planName: data.planName || 'Custom Plan',
          durationDays: data.durationDays || 1,
          status: data.status || 'unclaimed',
          createdAt: data.createdAt || new Date().toISOString(),
          ...data,
        } as LicenseRecord);
      }
    });
  } catch (err) {
    console.warn('Firestore fetch licenses:', err);
  }

  return Array.from(map.values());
}

// WIPE ALL UNUSED KEYS FROM FIREBASE TO PREVENT UNAUTHORIZED REDEMPTION & CLEAR SPACE
export async function wipeAllUnusedLicenses(): Promise<{ count: number; message: string }> {
  let wipedCount = 0;

  // 1. Delete from Firestore
  try {
    const colRef = collection(db, 'licenses');
    const snap = await getDocs(colRef);
    const deletePromises: Promise<void>[] = [];

    snap.forEach((d) => {
      const data = d.data() || {};
      const status = data.status || 'unclaimed';
      const claimedBy = data.claimedBy;
      // If status is unclaimed and nobody claimed it
      if (status === 'unclaimed' && !claimedBy) {
        deletePromises.push(deleteDoc(doc(db, 'licenses', d.id)));
        wipedCount++;
      }
    });

    await Promise.all(deletePromises);
  } catch (e) {
    console.warn('Firestore wipe unused keys warning:', e);
  }

  return {
    count: wipedCount,
    message: `Wiped ${wipedCount} unused license keys from Firebase Firestore. Space cleared!`,
  };
}

// WIPE ALL EXPIRED KEYS FROM FIREBASE TO CLEAR SPACE
export async function wipeAllExpiredLicenses(): Promise<{ count: number; message: string }> {
  let wipedCount = 0;
  const now = Date.now();

  // 1. Delete from Firestore
  try {
    const colRef = collection(db, 'licenses');
    const snap = await getDocs(colRef);
    const deletePromises: Promise<void>[] = [];

    snap.forEach((d) => {
      const data = d.data() || {};
      const isStatusExpired = data.status === 'expired';
      const isDateExpired = data.expiresAt && new Date(data.expiresAt).getTime() < now;
      if (isStatusExpired || isDateExpired) {
        deletePromises.push(deleteDoc(doc(db, 'licenses', d.id)));
        wipedCount++;
      }
    });

    await Promise.all(deletePromises);
  } catch (e) {
    console.warn('Firestore wipe expired keys warning:', e);
  }

  return {
    count: wipedCount,
    message: `Wiped ${wipedCount} expired license keys from Firebase Firestore. Space cleared!`,
  };
}

// DELETE A SINGLE SPECIFIC LICENSE KEY
export async function deleteSingleLicense(key: string): Promise<{ success: boolean; message: string }> {
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

  // Query live multi-user WhatsApp sessions from the server
  try {
    const idToken = await auth?.currentUser?.getIdToken();
    if (!idToken) {
      throw new Error('Sign in with the owner account to view all app users.');
    }
    const res = await fetch('/api/admin/users-status', {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) {
      throw new Error(`Live status request failed (${res.status}).`);
    }
    const data = await res.json();
    if (!data?.success || !data.statuses || typeof data.statuses !== 'object') {
      throw new Error('Live status response was incomplete.');
    }
    serverStatuses = data.statuses;
  } catch (err) {
    console.debug('Could not fetch server live user statuses:', err);
    throw new Error('Could not confirm WhatsApp user statuses from the server.');
  }

  const now = Date.now();

  // 1. Fetch from Firestore users collection
  try {
    const colRef = collection(db, 'users');
    const snap = await getDocsFromServer(colRef);
    snap.forEach((d) => {
      const data = d.data() || {};
      const uid = d.id;
      const isOwner = Boolean(data.email && data.email.toLowerCase() === OWNER_EMAIL.toLowerCase());
      const rawExpiresAt = data.licenseExpiresAt || null;
      const expMs = rawExpiresAt ? new Date(rawExpiresAt).getTime() : 0;
      // Strict countdown: if user has a finite expiration timestamp and is not owner, evaluate exact expiration
      const isDateExpired = !isOwner && (
        (rawExpiresAt && expMs > 0 && expMs <= now) ||
        (!rawExpiresAt && !data.isUnlimited)
      );
      const isUnlimited = isOwner || (!rawExpiresAt && Boolean(data.isUnlimited));
      const isExpired = isDateExpired || data.licenseStatus === 'expired';

      const liveStatus = serverStatuses[uid] || {};
      // Strict rule: only show connected if live socket is actually connected AND license is not expired
      const isActuallyConnected = !isExpired && Boolean(liveStatus.isConnected);
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
        licenseExpiresAt: rawExpiresAt,
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
  } catch (err) {
    console.warn('Firestore fetch users:', err);
    throw new Error('Could not confirm the registered user list from Firestore.');
  }

  return Array.from(usersMap.values());
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
  const cleanEmailKey = cleanEmail ? cleanEmail.replace(/[^a-z0-9]/g, '_') : '';

  // 1. Check persistent server trial endpoint first (authoritative and protects Firestore quota)
  try {
    const q = new URLSearchParams();
    if (userUid) q.set('uid', userUid);
    if (cleanEmail) q.set('email', cleanEmail);
    const res = await fetch(`/api/trial/status?${q.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && data.hasUsedTrial === true) {
        return true;
      }
    }
  } catch (apiErr) {
    console.debug('Server trial status check note:', apiErr);
  }

  // 2. Client-side fallback if server was unreachable and quota is available
  if (!isFirestoreQuotaExhausted()) {
    if (cleanEmailKey) {
      try {
        const trialRef = doc(db, 'claimed_trials', cleanEmailKey);
        const snap = await getDoc(trialRef);
        if (snap.exists()) {
          const d = snap.data();
          if (d?.claimedAt || d?.expiresAt || d?.userEmail) {
            return true;
          }
        }
      } catch (e: any) {
        reportFirestoreError(e);
      }
    }

    if (userUid) {
      try {
        const userRef = doc(db, 'users', userUid);
        const snap = await getDoc(userRef);
        if (snap.exists()) {
          const data = snap.data();
          if (data?.hasUsedTrial === true || data?.trialClaimedAt) {
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
  const cleanEmailKey = cleanEmail.replace(/[^a-z0-9]/g, '_');

  // Check with Firestore and server first: strictly once in a lifetime per email
  const alreadyClaimed = await checkUserTrialStatus(userUid, cleanEmail);
  if (alreadyClaimed) {
    return {
      success: false,
      message: 'The 30-minute test has already been used on this account. It is strictly once in a lifetime per user permanently linked to your email in Firebase.',
    };
  }

  // Direct Firestore verification to eliminate race conditions
  try {
    const trialRef = doc(db, 'claimed_trials', cleanEmailKey);
    const trialSnap = await getDoc(trialRef);
    if (trialSnap.exists()) {
      return {
        success: false,
        message: 'The 30-minute test has already been claimed on this email in Firebase. It is strictly once in a lifetime.',
      };
    }
  } catch (e) {
    console.warn('Direct Firestore trial race check:', e);
  }

  // The server owns the trial start time, enforces a lifetime claim, and writes
  // the resulting expiry atomically. Never extend a trial from a browser clock.
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
      return {
        success: false,
        message: data.message || 'Trial could not be saved; no trial time was activated.',
      };
    }
    finalExpiresAt = data.expiresAt;
  } catch (apiErr) {
    console.debug('Backend trial claim network note:', apiErr);
    return {
      success: false,
      message: 'Trial service is unavailable. No trial time was activated; please retry.',
    };
  }

  // The server transaction already persisted the canonical expiry and lifetime lock.
  // Synchronization reads that saved record rather than accepting a client-supplied time.
  try {
    await fetch('/api/whatsapp/sync-license', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userUid }),
    });
    await fetch('/api/whatsapp/reconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userUid }),
    });
  } catch (err) {
    console.warn('Trial saved, but live session synchronization will retry on the next status/license sync:', err);
  }

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
  try {
    const colRef = collection(db, 'users');
    const snap = await getDocs(colRef);
    const updates: Promise<void>[] = [];

    snap.forEach((d) => {
      const data = d.data() || {};
      const email = (data.email || '').toLowerCase();
      // Master Founder Account is NEVER terminated
      if (email === OWNER_EMAIL.toLowerCase()) return;

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
        )
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
        )
      );
      terminatedCount++;
    });

    await Promise.all(updates);
  } catch (e) {
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
          )
        );
      }
    });
    await Promise.all(licUpdates);
  } catch (e) {
    console.warn('Licenses collection termination note:', e);
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
      if (u.email?.toLowerCase() === OWNER_EMAIL.toLowerCase()) continue;
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


