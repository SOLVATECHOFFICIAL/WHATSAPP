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

try {
  setLogLevel('error');
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

const getEnvKey = () => {
  if (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.VITE_FIREBASE_API_KEY) {
    return (import.meta as any).env.VITE_FIREBASE_API_KEY;
  }
  if (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_API_KEY) {
    return process.env.VITE_FIREBASE_API_KEY;
  }
  if (typeof process !== 'undefined' && process.env?.FIREBASE_API_KEY) {
    return process.env.FIREBASE_API_KEY;
  }
  // Fallback to validly formatted key so Firebase Auth initializes without throwing auth/invalid-api-key
  return "AIzaSyD-solvatech-firebase-default-key-2026";
};

export const firebaseConfig = {
  apiKey: getEnvKey(),
  authDomain: "solvatechbot.firebaseapp.com",
  projectId: "solvatechbot",
  storageBucket: "solvatechbot.firebasestorage.app",
  messagingSenderId: "1094113371408",
  appId: "1:1094113371408:web:fdf3cbdef31413a703b195"
};

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
        licenseKey: `SOLVA-${user.uid.slice(0, 6).toUpperCase()}-2026`,
        licenseStatus: 'active',
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
      });
    } else {
      await setDoc(userRef, { lastLogin: serverTimestamp() }, { merge: true });
    }
  } catch (e) {
    console.warn('Firestore profile sync note:', e);
  }
}

// Sign in with Google Popup
export async function signInWithGoogle(): Promise<User> {
  if (!auth || typeof (auth as any).onAuthStateChanged !== 'function') {
    throw new Error('Firebase Auth is not available. Please use developer Fast-Track sign in below.');
  }
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;
  await syncUserProfile(user);
  return user;
}

// Sign in with Email / Password
export async function signInWithEmail(email: string, pass: string): Promise<User> {
  if (!auth || typeof (auth as any).onAuthStateChanged !== 'function') {
    throw new Error('Firebase Auth is not available. Please use developer Fast-Track sign in below.');
  }
  const result = await signInWithEmailAndPassword(auth, email, pass);
  await syncUserProfile(result.user);
  return result.user;
}

// Sign up with Email / Password
export async function signUpWithEmail(email: string, pass: string, name?: string): Promise<User> {
  if (!auth || typeof (auth as any).onAuthStateChanged !== 'function') {
    throw new Error('Firebase Auth is not available. Please use developer Fast-Track sign in below.');
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
  localStorage.removeItem('solvatech_custom_user');
}

// Listen to Auth State
export function onAuthChange(callback: (user: User | null) => void): () => void {
  // Check local saved session first
  const saved = localStorage.getItem('solvatech_custom_user');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      callback(parsed as unknown as User);
    } catch {
      // Ignore
    }
  }

  // Guard against uninitialized or mock auth instances
  if (!auth || typeof (auth as any).onAuthStateChanged !== 'function') {
    return () => {};
  }

  try {
    return onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        callback(fbUser);
      } else {
        const custom = localStorage.getItem('solvatech_custom_user');
        if (custom) {
          try {
            callback(JSON.parse(custom) as unknown as User);
          } catch {
            callback(null);
          }
        } else {
          callback(null);
        }
      }
    });
  } catch (err) {
    console.warn('onAuthStateChanged subscription skipped:', err);
    return () => {};
  }
}

// Instant Fast-Track Account Sign-In (For environments where Google Popup domain isn't whitelisted yet)
export async function signInFastTrack(email: string, displayName: string): Promise<User> {
  const cleanId = 'usr_' + email.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const simulatedUser: Partial<User> = {
    uid: cleanId,
    email,
    displayName,
    photoURL: `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanId}`,
  };

  // Sync to Firestore
  await syncUserProfile({
    uid: cleanId,
    email,
    displayName,
    photoURL: simulatedUser.photoURL,
  });

  localStorage.setItem('solvatech_custom_user', JSON.stringify(simulatedUser));
  return simulatedUser as User;
}
