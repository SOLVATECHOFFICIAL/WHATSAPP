import { db } from './firebase';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
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
  createdAt: string;
  expiresAt?: string;
  isSpecial5D?: boolean;
}

export const OWNER_EMAIL = 'awoyinfasolomon1@gmail.com';

// Pre-seeded & Legacy 5-Day Keys
export const SPECIAL_5D_KEYS: LicenseRecord[] = [
  { key: 'SOLVA-5D-VIP-ALPHA', planId: '5d', planName: '5 Days (Special VIP)', durationDays: 5, status: 'unclaimed', createdAt: new Date().toISOString(), isSpecial5D: true },
  { key: 'SOLVA-5D-VIP-BETA', planId: '5d', planName: '5 Days (Special VIP)', durationDays: 5, status: 'unclaimed', createdAt: new Date().toISOString(), isSpecial5D: true },
  { key: 'SOLVA-5D-VIP-GAMMA', planId: '5d', planName: '5 Days (Special VIP)', durationDays: 5, status: 'unclaimed', createdAt: new Date().toISOString(), isSpecial5D: true },
  { key: 'SOLVA-5D-SPECIAL-PRO', planId: '5d', planName: '5 Days (Special Pro)', durationDays: 5, status: 'unclaimed', createdAt: new Date().toISOString(), isSpecial5D: true },
  { key: 'SOLVA-5D-LEGACY-KEY', planId: '5d', planName: '5 Days (Legacy Key)', durationDays: 5, status: 'unclaimed', createdAt: new Date().toISOString(), isSpecial5D: true },
  { key: 'SOLVA-5DAYS-GOLD', planId: '5d', planName: '5 Days (Gold Edition)', durationDays: 5, status: 'unclaimed', createdAt: new Date().toISOString(), isSpecial5D: true },
  { key: 'SOLVA-5DAYS-ELITE', planId: '5d', planName: '5 Days (Elite VIP)', durationDays: 5, status: 'unclaimed', createdAt: new Date().toISOString(), isSpecial5D: true },
  { key: 'SOLVA-55555', planId: '5d', planName: '5 Days (5-Digit Code)', durationDays: 5, status: 'unclaimed', createdAt: new Date().toISOString(), isSpecial5D: true },
  { key: '55555', planId: '5d', planName: '5 Days (Classic 55555)', durationDays: 5, status: 'unclaimed', createdAt: new Date().toISOString(), isSpecial5D: true },
  { key: 'SOLVA-5D-2026', planId: '5d', planName: '5 Days (2026 Special)', durationDays: 5, status: 'unclaimed', createdAt: new Date().toISOString(), isSpecial5D: true },
];

export function generateKeyString(planPrefix: string): string {
  const randPart = Math.random().toString(36).substring(2, 6).toUpperCase();
  const randPart2 = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `SOLVA-${planPrefix.toUpperCase()}-${randPart}-${randPart2}`;
}

export async function createLicense(plan: LicensePlan, createdBy: string = OWNER_EMAIL): Promise<LicenseRecord> {
  const key = generateKeyString(plan.id);
  const record: LicenseRecord = {
    key,
    planId: plan.id,
    planName: plan.name,
    durationDays: plan.durationDays,
    status: 'unclaimed',
    createdAt: new Date().toISOString(),
  };

  try {
    const docRef = doc(db, 'licenses', key);
    await setDoc(docRef, record);
  } catch (err) {
    console.warn('Firestore license write:', err);
  }

  const existing = JSON.parse(localStorage.getItem('solvatech_licenses') || '[]');
  existing.unshift(record);
  localStorage.setItem('solvatech_licenses', JSON.stringify(existing));

  return record;
}

// Redeem key with ACCURATE TIME STACKING (preserves remaining minutes, hours, days)
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
  const cleanKey = keyToRedeem.trim().toUpperCase();

  if (!cleanKey) {
    return { success: false, message: 'Please enter a valid license key.' };
  }

  // Check special 5-Day & legacy keys
  let matchedLicense: LicenseRecord | null = null;
  const isSpecialMatch = SPECIAL_5D_KEYS.find((k) => k.key.toUpperCase() === cleanKey);

  // Also support 5-digit code or keys with '5D'
  const is5DigitOrLegacy =
    cleanKey === '55555' ||
    cleanKey === '90499' ||
    cleanKey.includes('5DAYS') ||
    cleanKey.startsWith('SOLVA-5D');

  if (isSpecialMatch) {
    matchedLicense = { ...isSpecialMatch };
  } else if (is5DigitOrLegacy) {
    matchedLicense = {
      key: cleanKey,
      planId: '5d',
      planName: '5 Days (Special Legacy VIP)',
      durationDays: 5,
      status: 'unclaimed',
      createdAt: new Date().toISOString(),
      isSpecial5D: true,
    };
  }

  // Check Firestore licenses collection
  if (!matchedLicense) {
    try {
      const docRef = doc(db, 'licenses', cleanKey);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        matchedLicense = snap.data() as LicenseRecord;
      }
    } catch (e) {
      console.warn('Firestore license read warning:', e);
    }
  }

  // Check localStorage licenses
  if (!matchedLicense) {
    const local = JSON.parse(localStorage.getItem('solvatech_licenses') || '[]');
    const localMatch = local.find((l: LicenseRecord) => l?.key?.toUpperCase() === cleanKey);
    if (localMatch) matchedLicense = localMatch;
  }

  if (!matchedLicense) {
    return {
      success: false,
      message: 'Invalid license key. Check your key format (e.g. SOLVA-1D-XXXX-XXXX or 5-Day VIP key).',
    };
  }

  // Check if standard key was already redeemed
  if (!matchedLicense.isSpecial5D && (matchedLicense.status === 'active' || matchedLicense.status === 'expired')) {
    if (matchedLicense.claimedBy !== userUid) {
      return { success: false, message: 'This license key has already been redeemed by another account.' };
    }
  }

  if (matchedLicense.status === 'revoked') {
    return { success: false, message: 'This license key has been revoked by administration.' };
  }

  // 100% ACCURATE TIME STACKING LOGIC
  // Retrieve user's current expiry
  let currentExpiryTime = 0;
  try {
    const userRef = doc(db, 'users', userUid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const userData = userSnap.data();
      if (userData.licenseExpiresAt) {
        const parsed = new Date(userData.licenseExpiresAt).getTime();
        if (parsed > Date.now()) {
          currentExpiryTime = parsed; // Stack on top of remaining time
        }
      }
    }
  } catch {
    // Fallback to local
    const localUser = JSON.parse(localStorage.getItem(`solvatech_user_${userUid}`) || '{}');
    if (localUser.licenseExpiresAt) {
      const parsed = new Date(localUser.licenseExpiresAt).getTime();
      if (parsed > Date.now()) {
        currentExpiryTime = parsed;
      }
    }
  }

  const now = Date.now();
  const currentRemainingMs = currentExpiryTime > now ? currentExpiryTime - now : 0;
  const addedDays = matchedLicense.durationDays || 1;
  const addedMinutes = matchedLicense.durationMinutes || 0;
  const addedDurationMs = addedDays * 24 * 60 * 60 * 1000 + addedMinutes * 60 * 1000;
  
  // Exact milliseconds stacked!
  const newExpiryMs = now + currentRemainingMs + addedDurationMs;
  const newExpiresAt = new Date(newExpiryMs).toISOString();

  // Compute breakdown for user feedback
  const prevHours = Math.floor(currentRemainingMs / 3600000);
  const prevMins = Math.floor((currentRemainingMs % 3600000) / 60000);
  const totalRemainingMs = newExpiryMs - now;
  const newDays = Math.floor(totalRemainingMs / 86400000);
  const remHours = Math.floor((totalRemainingMs % 86400000) / 3600000);
  const remMins = Math.floor((totalRemainingMs % 3600000) / 60000);

  // Update license document
  try {
    const docRef = doc(db, 'licenses', cleanKey);
    await setDoc(
      docRef,
      {
        ...matchedLicense,
        status: 'active',
        claimedBy: userUid,
        claimedEmail: userEmail,
        claimedAt: new Date().toISOString(),
        expiresAt: newExpiresAt,
      },
      { merge: true }
    );

    // Update user document
    const userRef = doc(db, 'users', userUid);
    await setDoc(
      userRef,
      {
        email: userEmail,
        licenseKey: cleanKey,
        licensePlan: matchedLicense.planName,
        licenseExpiresAt: newExpiresAt,
        licenseStatus: 'active',
        isUnlimited: false,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    // Update user_licenses
    const userLicRef = doc(db, 'user_licenses', userUid);
    await setDoc(
      userLicRef,
      {
        userId: userUid,
        email: userEmail,
        activeKey: cleanKey,
        plan: matchedLicense.planName,
        durationDays: addedDays,
        expiresAt: newExpiresAt,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (e) {
    console.warn('Firestore write warning:', e);
  }

  // Local storage sync
  localStorage.setItem(
    `solvatech_user_${userUid}`,
    JSON.stringify({
      email: userEmail,
      licenseKey: cleanKey,
      licensePlan: matchedLicense.planName,
      licenseExpiresAt: newExpiresAt,
      licenseStatus: 'active',
      isUnlimited: false,
    })
  );

  const isStacked = currentRemainingMs > 0;
  const message = isStacked
    ? `🎉 ${matchedLicense.planName} Activated! Added +${addedDays} Days (+${addedDays * 24}h) stacked on top of your existing ${prevHours}h ${prevMins}m balance. New total: ${newDays > 0 ? `${newDays}d ` : ''}${remHours}h ${remMins}m left!`
    : `🎉 ${matchedLicense.planName} Activated! You have ${addedDays} Days of full 24/7 WhatsApp bot access. Timer is running!`;

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
): Promise<void> {
  const email = userEmail || `${userUid}@solvatech.com`;
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

  // Update local storage
  const localUser = JSON.parse(localStorage.getItem(`solvatech_user_${userUid}`) || '{}');
  localStorage.setItem(
    `solvatech_user_${userUid}`,
    JSON.stringify({
      ...localUser,
      uid: userUid,
      email,
      isUnlimited: enableUnlimited,
      licenseStatus: enableUnlimited ? 'unlimited' : 'expired',
      licensePlan: enableUnlimited ? '👑 Unlimited Lifetime (Admin Granted)' : 'Expired Plan',
      licenseExpiresAt: enableUnlimited ? null : new Date().toISOString(),
    })
  );
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

// Fetch all licenses (including pre-seeded 5-day keys)
export async function fetchAllLicenses(): Promise<LicenseRecord[]> {
  const map = new Map<string, LicenseRecord>();

  // Add 5 special pre-seeded keys first
  SPECIAL_5D_KEYS.forEach((k) => map.set(k.key, k));

  try {
    const colRef = collection(db, 'licenses');
    const snap = await getDocs(colRef);
    snap.forEach((d) => {
      const data = d.data() || {};
      const key = data.key || d.id || 'SOLVA-KEY';
      map.set(key, {
        key,
        planId: data.planId || '1d',
        planName: data.planName || 'Custom Plan',
        durationDays: data.durationDays || 1,
        status: data.status || 'unclaimed',
        createdAt: data.createdAt || new Date().toISOString(),
        ...data,
      } as LicenseRecord);
    });
  } catch (err) {
    console.warn('Firestore fetch licenses:', err);
  }

  const local = JSON.parse(localStorage.getItem('solvatech_licenses') || '[]');
  (Array.isArray(local) ? local : []).forEach((l: any, i: number) => {
    const key = l?.key || `SOLVA-LOCAL-${i}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        planId: l?.planId || '1d',
        planName: l?.planName || 'Local Plan',
        durationDays: l?.durationDays || 1,
        status: l?.status || 'unclaimed',
        createdAt: l?.createdAt || new Date().toISOString(),
        ...l,
      });
    }
  });

  return Array.from(map.values());
}

// Fetch all registered users for admin
export async function fetchAllUsers(): Promise<any[]> {
  try {
    const colRef = collection(db, 'users');
    const snap = await getDocs(colRef);
    const results: any[] = [];
    snap.forEach((d) => {
      const data = d.data() || {};
      results.push({
        uid: d.id,
        email: data.email || 'user@solvatech.com',
        displayName: data.displayName || data.email?.split('@')[0] || 'Solvatech User',
        isUnlimited: !!data.isUnlimited,
        licensePlan: data.licensePlan || (data.isUnlimited ? '👑 Unlimited Lifetime' : 'Expired Plan'),
        licenseStatus: data.licenseStatus || (data.isUnlimited ? 'unlimited' : 'expired'),
        licenseKey: data.licenseKey || null,
        licenseExpiresAt: data.licenseExpiresAt || null,
        lastLogin: data.lastLogin || data.updatedAt || new Date().toISOString(),
      });
    });
    if (results.length > 0) return results;
  } catch (err) {
    console.warn('Firestore fetch users:', err);
  }

  return [
    {
      uid: 'owner_master',
      email: OWNER_EMAIL,
      displayName: 'Solomon Oladimeji (Owner)',
      licenseKey: 'SOLVA-OWNER-UNLIMITED-MASTER',
      licensePlan: 'Unlimited Lifetime Master',
      licenseStatus: 'unlimited',
      isUnlimited: true,
      isOwner: true,
      lastLogin: new Date().toISOString(),
    },
    {
      uid: 'user_vip_test',
      email: 'client@solvatech.com',
      displayName: 'Active Client (Test User)',
      licenseKey: 'SOLVA-5D-VIP-ALPHA',
      licensePlan: '5 Days (Special VIP)',
      licenseStatus: 'active',
      isUnlimited: false,
      licenseExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    }
  ];
}

// Countdown time calculator down to exact days, hours, minutes, seconds
export function calculateRemainingTime(expiresAt?: string | null, isUnlimited?: boolean): {
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

  const diffMs = new Date(expiresAt).getTime() - Date.now();
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

// 30-MINUTE TEST SYSTEM — LIFETIME LOCK PER GMAIL ACCOUNT
export async function checkUserTrialStatus(
  userUid: string,
  userEmail?: string | null
): Promise<boolean> {
  if (!userUid) return false;

  // 1. Check local storage
  const localUid = localStorage.getItem(`solvatech_trial_${userUid}`);
  if (localUid === 'true') return true;

  if (userEmail) {
    const localEmail = localStorage.getItem(`solvatech_trial_${userEmail.toLowerCase()}`);
    if (localEmail === 'true') return true;
  }

  // 2. Check Firestore user document
  try {
    const userRef = doc(db, 'users', userUid);
    const snap = await getDoc(userRef);
    if (snap.exists() && snap.data()?.hasUsedTrial) {
      localStorage.setItem(`solvatech_trial_${userUid}`, 'true');
      if (userEmail) {
        localStorage.setItem(`solvatech_trial_${userEmail.toLowerCase()}`, 'true');
      }
      return true;
    }
  } catch (e) {
    console.warn('Trial status check warning:', e);
  }

  // 3. Check claimed_trials collection indexed by email
  if (userEmail) {
    const cleanEmailKey = userEmail.toLowerCase().replace(/[^a-z0-9]/g, '_');
    try {
      const trialRef = doc(db, 'claimed_trials', cleanEmailKey);
      const snap = await getDoc(trialRef);
      if (snap.exists()) {
        localStorage.setItem(`solvatech_trial_${userUid}`, 'true');
        localStorage.setItem(`solvatech_trial_${userEmail.toLowerCase()}`, 'true');
        return true;
      }
    } catch (e) {
      console.warn('Claimed trial check warning:', e);
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
      message: 'You must be signed in with your Google account to activate the 30-minute test.',
    };
  }

  const alreadyClaimed = await checkUserTrialStatus(userUid, userEmail);
  if (alreadyClaimed) {
    return {
      success: false,
      message: 'The 30-minute test has already been used on this Google account. It can only be claimed once in a lifetime.',
    };
  }

  // Fetch current remaining time to stack 30 minutes on top
  let currentExpiryTime = 0;
  try {
    const userRef = doc(db, 'users', userUid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const userData = userSnap.data();
      if (userData.licenseExpiresAt) {
        const parsed = new Date(userData.licenseExpiresAt).getTime();
        if (parsed > Date.now()) {
          currentExpiryTime = parsed;
        }
      }
    }
  } catch {
    const localUser = JSON.parse(localStorage.getItem(`solvatech_user_${userUid}`) || '{}');
    if (localUser.licenseExpiresAt) {
      const parsed = new Date(localUser.licenseExpiresAt).getTime();
      if (parsed > Date.now()) {
        currentExpiryTime = parsed;
      }
    }
  }

  const now = Date.now();
  const currentRemainingMs = currentExpiryTime > now ? currentExpiryTime - now : 0;
  const TRIAL_DURATION_MS = 30 * 60 * 1000; // 30 Minutes
  const newExpiryMs = now + currentRemainingMs + TRIAL_DURATION_MS;
  const newExpiresAt = new Date(newExpiryMs).toISOString();
  const cleanEmailKey = userEmail.toLowerCase().replace(/[^a-z0-9]/g, '_');

  // Persist to Firestore: users collection and claimed_trials collection
  try {
    const userRef = doc(db, 'users', userUid);
    await setDoc(
      userRef,
      {
        licenseExpiresAt: newExpiresAt,
        licensePlan: '⚡ 30-Minute Test (Active)',
        hasUsedTrial: true,
        trialClaimedAt: new Date().toISOString(),
        trialEmail: userEmail,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    const trialRef = doc(db, 'claimed_trials', cleanEmailKey);
    await setDoc(trialRef, {
      userUid,
      userEmail,
      claimedAt: new Date().toISOString(),
      expiresAt: newExpiresAt,
    });
  } catch (err) {
    console.error('Error saving 30-minute trial to Firestore:', err);
  }

  // Lock locally forever
  localStorage.setItem(`solvatech_trial_${userUid}`, 'true');
  localStorage.setItem(`solvatech_trial_${userEmail.toLowerCase()}`, 'true');

  const cachedUser = JSON.parse(localStorage.getItem(`solvatech_user_${userUid}`) || '{}');
  localStorage.setItem(
    `solvatech_user_${userUid}`,
    JSON.stringify({
      ...cachedUser,
      licenseExpiresAt: newExpiresAt,
      licensePlan: '⚡ 30-Minute Test (Active)',
      hasUsedTrial: true,
      trialClaimedAt: new Date().toISOString(),
    })
  );

  return {
    success: true,
    message: '🎉 30-minute test activated! Your countdown has begun.',
    expiresAt: newExpiresAt,
  };
}

