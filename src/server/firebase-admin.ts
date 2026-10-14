import 'dotenv/config';
import { cert, getApp as getAdminApp, getApps as getAdminApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  FieldValue,
  getFirestore as getAdminFirestore,
  type Firestore,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from 'firebase-admin/firestore';
import {
  initializeApp as initClientApp,
  getApps as getClientApps,
} from 'firebase/app';
import {
  initializeFirestore as initClientFirestore,
  doc as clientDoc,
  collection as clientCollection,
  getDoc as clientGetDoc,
  getDocs as clientGetDocs,
  setDoc as clientSetDoc,
  deleteDoc as clientDeleteDoc,
  runTransaction as clientRunTransaction,
  writeBatch as clientWriteBatch,
  onSnapshot as clientOnSnapshot,
  serverTimestamp as clientServerTimestamp,
} from 'firebase/firestore';
import { firebaseConfig } from '../services/firebase-config.ts';

class InMemoryDocumentReference {
  public id: string;
  public path: string;
  private store: Map<string, any>;

  constructor(id: string, path: string, store: Map<string, any>) {
    this.id = id;
    this.path = path;
    this.store = store;
  }

  async get(): Promise<any> {
    const data = this.store.get(this.path);
    const exists = data !== undefined;
    return {
      id: this.id,
      path: this.path,
      exists,
      data: () => (exists ? JSON.parse(JSON.stringify(data)) : undefined),
    };
  }

  async set(data: any, options?: { merge?: boolean }): Promise<void> {
    const cleanData = JSON.parse(JSON.stringify(data));
    if (options?.merge && this.store.has(this.path)) {
      const existing = this.store.get(this.path) || {};
      this.store.set(this.path, { ...existing, ...cleanData });
    } else {
      this.store.set(this.path, cleanData);
    }
  }

  async delete(): Promise<void> {
    this.store.delete(this.path);
  }

  onSnapshot(
    onNext: (snapshot: any) => void,
    _onError?: (error: Error) => void,
  ): () => void {
    void this.get().then(onNext);
    return () => {};
  }
}

class InMemoryCollectionReference {
  public id: string;
  public path: string;
  private store: Map<string, any>;
  private firestore: InMemoryFirestore;

  constructor(
    id: string,
    path: string,
    store: Map<string, any>,
    firestore: InMemoryFirestore,
  ) {
    this.id = id;
    this.path = path;
    this.store = store;
    this.firestore = firestore;
  }

  doc(id?: string): InMemoryDocumentReference {
    const docId = id || Math.random().toString(36).substring(2, 15);
    return this.firestore.doc(this.path, docId);
  }

  async get(): Promise<any> {
    const prefix = `${this.path}/`;
    const docs: any[] = [];
    for (const [key, val] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        const sub = key.slice(prefix.length);
        if (!sub.includes('/')) {
          docs.push({
            id: sub,
            path: key,
            exists: true,
            data: () => JSON.parse(JSON.stringify(val)),
          });
        }
      }
    }
    const docChanges = () =>
      docs.map((docItem) => ({
        type: 'added',
        doc: docItem,
      }));

    return {
      empty: docs.length === 0,
      size: docs.length,
      docs,
      docChanges,
      forEach: (cb: (doc: any) => void) => docs.forEach(cb),
    };
  }

  onSnapshot(
    onNext: (snapshot: any) => void,
    _onError?: (error: Error) => void,
  ): () => void {
    void this.get().then(onNext);
    return () => {};
  }
}

class InMemoryFirestore {
  public store: Map<string, any> = new Map<string, any>();

  doc(...segments: string[]): InMemoryDocumentReference {
    const fullPath = segments
      .flatMap((s) => s.split('/'))
      .filter(Boolean)
      .join('/');
    const parts = fullPath.split('/');
    const id = parts[parts.length - 1] || 'root';
    return new InMemoryDocumentReference(id, fullPath, this.store);
  }

  collection(...segments: string[]): InMemoryCollectionReference {
    const fullPath = segments
      .flatMap((s) => s.split('/'))
      .filter(Boolean)
      .join('/');
    const parts = fullPath.split('/');
    const id = parts[parts.length - 1] || 'root';
    return new InMemoryCollectionReference(id, fullPath, this.store, this);
  }

  async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
    const tx = {
      get: async (ref: any) => ref.get(),
      set: async (ref: any, data: any, options?: any) => ref.set(data, options),
      delete: async (ref: any) => ref.delete(),
      update: async (ref: any, data: any) => ref.set(data, { merge: true }),
    };
    return updateFunction(tx);
  }

  batch(): any {
    const operations: Array<() => Promise<void>> = [];
    return {
      set: (ref: any, data: any, options?: any) => {
        operations.push(() => ref.set(data, options));
        return this;
      },
      delete: (ref: any) => {
        operations.push(() => ref.delete());
        return this;
      },
      update: (ref: any, data: any) => {
        operations.push(() => ref.set(data, { merge: true }));
        return this;
      },
      commit: async () => {
        for (const op of operations) {
          await op();
        }
      },
    };
  }
}

class ClientFirestoreAdapter {
  public clientDb: any;
  constructor(clientDb: any) {
    this.clientDb = clientDb;
  }
  doc(...segments: string[]): any {
    const fullPath = segments.flatMap((s) => s.split('/')).filter(Boolean).join('/');
    return clientDoc(this.clientDb, fullPath);
  }
  collection(...segments: string[]): any {
    const fullPath = segments.flatMap((s) => s.split('/')).filter(Boolean).join('/');
    return clientCollection(this.clientDb, fullPath);
  }
  async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
    return clientRunTransaction(this.clientDb, async (tx) => {
      const wrappedTx = {
        get: async (ref: any) => {
          const snap = await tx.get(ref);
          const isExisting = typeof snap.exists === 'function' ? snap.exists() : Boolean(snap.exists);
          return {
            id: snap.id,
            ref: snap.ref,
            exists: isExisting,
            data: () => snap.data(),
            get: (k: string) => (snap.data() as any)?.[k],
          };
        },
        set: (ref: any, data: any, options?: any) => {
          return tx.set(ref, data, options);
        },
        update: (ref: any, data: any) => {
          return tx.update(ref, data);
        },
        delete: (ref: any) => {
          return tx.delete(ref);
        },
      };
      return updateFunction(wrappedTx);
    });
  }
  batch(): any {
    const b = clientWriteBatch(this.clientDb);
    return {
      set: (ref: any, data: any, options?: any) => {
        b.set(ref, data, options);
        return this;
      },
      update: (ref: any, data: any) => {
        b.update(ref, data);
        return this;
      },
      delete: (ref: any) => {
        b.delete(ref);
        return this;
      },
      commit: async () => {
        await b.commit();
      },
    };
  }
}

function initializeFirebaseBackend(): { firestore: any; isMock: boolean } {
  // Option 1: Admin SDK via service account credentials
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) {
    try {
      const serviceAccount = JSON.parse(raw);
      if (
        typeof serviceAccount.client_email === 'string' &&
        typeof serviceAccount.private_key === 'string'
      ) {
        const projectId =
          String(serviceAccount.project_id || '') ||
          process.env.VITE_FIREBASE_PROJECT_ID ||
          process.env.FIREBASE_PROJECT_ID ||
          firebaseConfig.projectId ||
          'solvatechbot';

        const adminApp = getAdminApps().length
          ? getAdminApp()
          : initializeAdminApp({
              credential: cert(serviceAccount as Parameters<typeof cert>[0]),
              projectId,
            });

        console.log(`[Firebase Backend] Connected to Cloud Firestore via Firebase Admin SDK (${projectId}).`);
        return { firestore: getAdminFirestore(adminApp), isMock: false };
      }
    } catch (err: any) {
      console.warn('[Firebase Admin] Service account parse note:', err?.message || err);
    }
  }

  // Option 2: Direct connection to live Cloud Firestore via Client SDK with firebaseConfig
  try {
    const appName = 'solvatech-server-firestore';
    const existing = getClientApps().find((a) => a.name === appName);
    const clientApp = existing || initClientApp(firebaseConfig, appName);
    const clientDb = initClientFirestore(clientApp, {
      ignoreUndefinedProperties: true,
    });
    console.log(`[Firebase Backend] Connected directly to live Cloud Firestore (${firebaseConfig.projectId}).`);
    return { firestore: new ClientFirestoreAdapter(clientDb), isMock: false };
  } catch (clientErr: any) {
    console.warn('[Firebase Backend] Client Firestore connection note:', clientErr?.message || clientErr);
  }

  // Option 3: In-memory fallback
  console.warn('[Firebase Backend] Using in-memory Firestore engine fallback.');
  return { firestore: new InMemoryFirestore(), isMock: true };
}

const { firestore: activeDb, isMock } = initializeFirebaseBackend();

export const isFirebaseMock = isMock;
export const db: any = activeDb;

export function doc(firestore: any, ...segments: string[]): any {
  const path = segments
    .flatMap((s) => s.split('/'))
    .filter(Boolean)
    .join('/');
  if (firestore && typeof firestore.doc === 'function') {
    return firestore.doc(path);
  }
  return db.doc(path);
}

export function collection(firestore: any, ...segments: string[]): any {
  const path = segments
    .flatMap((s) => s.split('/'))
    .filter(Boolean)
    .join('/');
  if (firestore && typeof firestore.collection === 'function') {
    return firestore.collection(path);
  }
  return db.collection(path);
}

export async function getDoc(reference: any): Promise<any> {
  if (!reference) return { exists: false, data: () => undefined, id: '' };
  try {
    const snap = typeof reference.get === 'function' ? await reference.get() : await clientGetDoc(reference);
    const isExisting = typeof snap.exists === 'function' ? snap.exists() : Boolean(snap.exists);
    return {
      id: snap.id,
      ref: snap.ref || reference,
      exists: isExisting,
      data: () => (typeof snap.data === 'function' ? snap.data() : snap.data),
      get: (fieldPath: string) => (typeof snap.get === 'function' ? snap.get(fieldPath) : snap.data()?.[fieldPath]),
    };
  } catch (err) {
    console.warn('[Firestore getDoc] note:', err);
    return { exists: false, data: () => undefined, id: reference?.id || '' };
  }
}

export async function getDocs(reference: any): Promise<any> {
  if (!reference) return { empty: true, size: 0, docs: [], forEach: () => {} };
  try {
    const snap = typeof reference.get === 'function' ? await reference.get() : await clientGetDocs(reference);
    const rawDocs = snap.docs || [];
    const normalizedDocs = rawDocs.map((d: any) => {
      const isExisting = typeof d.exists === 'function' ? d.exists() : Boolean(d.exists);
      return {
        id: d.id,
        ref: d.ref,
        exists: isExisting,
        data: () => (typeof d.data === 'function' ? d.data() : d.data),
        get: (fieldPath: string) => (typeof d.get === 'function' ? d.get(fieldPath) : d.data()?.[fieldPath]),
      };
    });
    return {
      empty: normalizedDocs.length === 0,
      size: normalizedDocs.length,
      docs: normalizedDocs,
      forEach: (cb: (doc: any) => void) => normalizedDocs.forEach(cb),
    };
  } catch (err) {
    console.warn('[Firestore getDocs] note:', err);
    return { empty: true, size: 0, docs: [], forEach: () => {} };
  }
}

export function setDoc(reference: any, data: any, options?: any): Promise<void> {
  if (reference && typeof reference.set === 'function') {
    return reference.set(data, options);
  }
  return clientSetDoc(reference, data, options || {});
}

export function deleteDoc(reference: any): Promise<void> {
  if (reference && typeof reference.delete === 'function') {
    return reference.delete();
  }
  return clientDeleteDoc(reference);
}

export function runTransaction<T>(
  firestore: any,
  updateFunction: (transaction: any) => Promise<T>,
): Promise<T> {
  if (firestore && typeof firestore.runTransaction === 'function') {
    return firestore.runTransaction(updateFunction);
  }
  return db.runTransaction(updateFunction);
}

export function writeBatch(firestore: any): any {
  if (firestore && typeof firestore.batch === 'function') {
    return firestore.batch();
  }
  return db.batch();
}

export function onSnapshot(reference: any, ...args: any[]): () => void {
  if (reference && typeof reference.onSnapshot === 'function') {
    return reference.onSnapshot(...args);
  }
  return clientOnSnapshot(reference, ...args as [any, any]);
}

export function serverTimestamp(): any {
  try {
    return FieldValue.serverTimestamp();
  } catch {
    try {
      return clientServerTimestamp();
    } catch {
      return new Date().toISOString();
    }
  }
}

export async function listAllFirebaseUsers(): Promise<Array<{ uid: string; email?: string; displayName?: string; createdAt?: string }>> {
  if (isMock) return [];
  try {
    const adminApps = getAdminApps();
    if (!adminApps.length) return [];
    const authAdmin = getAuth(adminApps[0]);
    const listResult = await authAdmin.listUsers(1000);
    return listResult.users.map((u) => ({
      uid: u.uid,
      email: u.email || undefined,
      displayName: u.displayName || undefined,
      createdAt: u.metadata?.creationTime || undefined,
    }));
  } catch (err) {
    console.warn('[Firebase Admin] Error listing auth users:', err);
    return [];
  }
}
