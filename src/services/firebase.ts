import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  setLogLevel,
} from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.ts';
import { isFirestoreQuotaExhausted, reportFirestoreError } from './firestore-status.ts';

export { firebaseConfig, isFirestoreQuotaExhausted, reportFirestoreError };

try {
  setLogLevel('silent');
} catch {}

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User
} from 'firebase/auth';

// Initialize Firebase App
export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

let dbInstance: any;
try {
  dbInstance = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    ignoreUndefinedProperties: true,
  });
} catch {
  try {
    dbInstance = getFirestore(app);
  } catch (err) {
    console.warn('Firestore fallback instance note:', err);
    dbInstance = {} as any;
  }
}
export const db = dbInstance;

let authInstance: any = null;
try {
  authInstance = getAuth(app);
} catch (e) {
  console.warn('Firebase Auth initialization note:', e);
  authInstance = null;
}
export const auth = authInstance;

let googleProviderInstance: any = null;
try {
  googleProviderInstance = new GoogleAuthProvider();
  googleProviderInstance.setCustomParameters({ prompt: 'select_account' });
} catch {
  googleProviderInstance = null;
}
const googleProvider = googleProviderInstance;

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  linkedPhone?: string;
  licenseKey?: string;
  licenseStatus?: 'active' | 'free' | 'enterprise';
  createdAt?: any;
  lastLogin?: any;
}

// Sync user to Firestore with instant 30-Minute Free Trial auto-tethering
export async function syncUserProfile(user: { uid: string; email: string | null; displayName: string | null; photoURL?: string | null }): Promise<{ isNewUser: boolean; trialExpiresAt: string | null }> {
  let isNewUser = false;
  let trialExpiresAt: string | null = null;
  const cleanEmail = (user.email || '').trim().toLowerCase();
  const cleanEmailKey = cleanEmail.replace(/[^a-z0-9]/g, '_');

  if (!isFirestoreQuotaExhausted() && db && (db as any).app) {
    try {
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        isNewUser = true;
        // Auto-tether 30-minute free trial for all brand new accounts!
        const now = Date.now();
        trialExpiresAt = new Date(now + 30 * 60 * 1000).toISOString();
        const claimedAt = new Date(now).toISOString();

        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || cleanEmail.split('@')[0] || 'Solvatech User',
          photoURL: user.photoURL || null,
          licenseKey: 'FREE_TRIAL_30M',
          licensePlan: '⚡ 30-Minute Free Trial (Active)',
          licenseStatus: 'active',
          licenseExpiresAt: trialExpiresAt,
          hasUsedTrial: true,
          trialClaimedAt: claimedAt,
          trialEmail: cleanEmail,
          lifetimeTrialLocked: true,
          createdAt: serverTimestamp(),
          lastLogin: serverTimestamp(),
        });

        // Also save into user_licenses
        try {
          const userLicRef = doc(db, 'user_licenses', user.uid);
          await setDoc(userLicRef, {
            userId: user.uid,
            email: user.email,
            activeKey: 'FREE_TRIAL_30M',
            plan: '⚡ 30-Minute Free Trial (Active)',
            status: 'active',
            expiresAt: trialExpiresAt,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch {}

        // Also record in claimed_trials so trial cannot be abused
        if (cleanEmailKey) {
          try {
            await setDoc(doc(db, 'claimed_trials', cleanEmailKey), {
              userUid: user.uid,
              userEmail: cleanEmail,
              claimedAt,
              expiresAt: trialExpiresAt,
              lifetimeLocked: true,
            });
          } catch {}
        }

        // Cache in localStorage immediately
        try {
          localStorage.setItem(`solvatech_trial_claimed_${user.uid}`, 'true');
          localStorage.setItem(`solvatech_license_expiresAt_${user.uid}`, trialExpiresAt);
          if (cleanEmail) {
            localStorage.setItem(`solvatech_trial_claimed_${cleanEmail}`, 'true');
            localStorage.setItem(`solvatech_license_expiresAt_${cleanEmail}`, trialExpiresAt);
          }
        } catch {}
      } else {
        await setDoc(userRef, { lastLogin: serverTimestamp() }, { merge: true });
        const existingData = snap.data();
        if (existingData?.licenseExpiresAt) {
          trialExpiresAt = existingData.licenseExpiresAt;
        }
      }
    } catch (e) {
      reportFirestoreError(e);
      console.warn('Firestore profile sync note:', e);
    }
  }

  if (user.uid && user.email) {
    void fetch('/api/users/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email.split('@')[0],
        isNewUser,
        autoTrial: isNewUser,
        expiresAt: trialExpiresAt,
      }),
    }).catch(() => {});
  }

  return { isNewUser, trialExpiresAt };
}

// Sign in with Google Popup
export async function signInWithGoogle(): Promise<User> {
  if (!auth || typeof (auth as any).onAuthStateChanged !== 'function') {
    throw new Error('Firebase Authentication is currently initializing. Please retry in a moment.');
  }
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;
  await syncUserProfile(user);
  return user;
}

// Sign in with Email / Password
export async function signInWithEmail(email: string, pass: string): Promise<User> {
  if (!auth || typeof (auth as any).onAuthStateChanged !== 'function') {
    throw new Error('Firebase Authentication is currently initializing. Please retry in a moment.');
  }
  const result = await signInWithEmailAndPassword(auth, email, pass);
  await syncUserProfile(result.user);
  return result.user;
}

// Sign up with Email / Password
export async function signUpWithEmail(email: string, pass: string, name?: string): Promise<User> {
  if (!auth || typeof (auth as any).onAuthStateChanged !== 'function') {
    throw new Error('Firebase Authentication is currently initializing. Please retry in a moment.');
  }
  const result = await createUserWithEmailAndPassword(auth, email, pass);
  if (name) {
    await updateProfile(result.user, { displayName: name });
  }
  await syncUserProfile({
    uid: result.user.uid,
    email: result.user.email,
    displayName: name || result.user.displayName,
    photoURL: result.user.photoURL,
  });
  return result.user;
}

// Sign out
export async function signOutUser(): Promise<void> {
  try {
    if (auth && typeof (auth as any).onAuthStateChanged === 'function') {
      await fbSignOut(auth);
    }
  } catch (e) {
    console.error('Sign out error:', e);
  }
  try {
    sessionStorage.clear();
  } catch {}
}

// Listen to Auth State
export function onAuthChange(callback: (user: User | null) => void): () => void {
  // Guard against uninitialized auth instances
  if (!auth || typeof (auth as any).onAuthStateChanged !== 'function') {
    return () => {};
  }

  try {
    return onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        void syncUserProfile(fbUser);
      }
      callback(fbUser || null);
    });
  } catch (err) {
    console.warn('onAuthStateChanged subscription skipped:', err);
    return () => {};
  }
}
