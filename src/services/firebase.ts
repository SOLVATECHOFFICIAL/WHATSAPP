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

// Sync user to Firestore
export async function syncUserProfile(user: { uid: string; email: string | null; displayName: string | null; photoURL?: string | null }) {
  try {
    if (!db || !(db as any).app) return;
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || 'Solvatech User',
        photoURL: user.photoURL || null,
        licenseKey: null,
        licensePlan: 'New User (No Key)',
        licenseStatus: 'expired',
        licenseExpiresAt: null,
        hasUsedTrial: false,
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
      });
    } else {
      await setDoc(userRef, { lastLogin: serverTimestamp() }, { merge: true });
    }
    if (user.uid && user.email) {
      void fetch('/api/users/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || user.email.split('@')[0],
        }),
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('Firestore profile sync note:', e);
  }
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
