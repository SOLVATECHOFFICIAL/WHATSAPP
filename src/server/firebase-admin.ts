import 'dotenv/config';
import fs from 'fs';
import path from 'path';
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
  setLogLevel as setClientLogLevel,
} from 'firebase/firestore';
import { firebaseConfig } from '../services/firebase-config.ts';
import { isFirestoreQuotaExhausted, reportFirestoreError } from '../services/firestore-status.ts';

try {
  setClientLogLevel('silent');
} catch {}

const IN_MEMORY_CACHE_FILE = path.resolve(process.cwd(), '.firestore_cache.json');

class InMemoryDocumentReference {
  public id: string;
  public path: string;
  private store: Map<string, any>;
  private firestore: InMemoryFirestore;

  constructor(id: string, path: string, store: Map<string, any>, firestore: InMemoryFirestore) {
    this.id = id;
    this.path = path;
    this.store = store;
    this.firestore = firestore;
  }

  async get(): Promise<any> {
    const data = this.store.get(this.path);
    const exists = data !== undefined;
    return {
      id: this.id,
      path: this.path,
      exists,
      data: () => (exists ? JSON.parse(JSON.stringify(data)) : undefined),
      get: (k: string) => data?.[k],
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
    this.firestore.schedulePersist();
  }

  async delete(): Promise<void> {
    this.store.delete(this.path);
    this.firestore.schedulePersist();
  }

  onSnapshot(
    onNext: (snapshot: any) => void,
    _onError?: (error: Error) => void,
  ): () => void {
    void this.get().then((snap) => {
      try {
        onNext(snap);
      } catch {}
    });
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
            get: (k: string) => val?.[k],
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
    void this.get().then((snap) => {
      try {
        onNext(snap);
      } catch {}
    });
    return () => {};
  }
}

export class InMemoryFirestore {
  public store: Map<string, any> = new Map<string, any>();
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(IN_MEMORY_CACHE_FILE)) {
        const raw = fs.readFileSync(IN_MEMORY_CACHE_FILE, 'utf-8');
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') {
          for (const [k, v] of Object.entries(obj)) {
            this.store.set(k, v);
          }
        }
      }
    } catch {}
  }

  public schedulePersist(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      try {
        const obj: Record<string, any> = {};
        for (const [k, v] of this.store.entries()) {
          obj[k] = v;
        }
        fs.writeFileSync(IN_MEMORY_CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
      } catch {}
    }, 1000);
  }

  doc(...segments: string[]): InMemoryDocumentReference {
    const fullPath = segments
      .flatMap((s) => s.split('/'))
      .filter(Boolean)
      .join('/');
    const parts = fullPath.split('/');
    const id = parts[parts.length - 1] || 'root';
    return new InMemoryDocumentReference(id, fullPath, this.store, this);
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

export const globalFallbackStore = new InMemoryFirestore();

class ClientFirestoreAdapter {
  public clientDb: any;
  public fallback: InMemoryFirestore;

  constructor(clientDb: any, fallback: InMemoryFirestore) {
    this.clientDb = clientDb;
    this.fallback = fallback;
  }

  doc(...segments: string[]): any {
    const fullPath = segments.flatMap((s) => s.split('/')).filter(Boolean).join('/');
    if (isFirestoreQuotaExhausted()) {
      return this.fallback.doc(fullPath);
    }
    return clientDoc(this.clientDb, fullPath);
  }

  collection(...segments: string[]): any {
    const fullPath = segments.flatMap((s) => s.split('/')).filter(Boolean).join('/');
    if (isFirestoreQuotaExhausted()) {
      return this.fallback.collection(fullPath);
    }
    return clientCollection(this.clientDb, fullPath);
  }

  async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
    if (isFirestoreQuotaExhausted()) {
      return this.fallback.runTransaction(updateFunction);
    }
    try {
      return await clientRunTransaction(this.clientDb, async (tx) => {
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
    } catch (err: any) {
      reportFirestoreError(err);
      return this.fallback.runTransaction(updateFunction);
    }
  }

  batch(): any {
    if (isFirestoreQuotaExhausted()) {
      return this.fallback.batch();
    }
    try {
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
          try {
            await b.commit();
          } catch (err: any) {
            reportFirestoreError(err);
          }
        },
      };
    } catch (err: any) {
      reportFirestoreError(err);
      return this.fallback.batch();
    }
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
    return { firestore: new ClientFirestoreAdapter(clientDb, globalFallbackStore), isMock: false };
  } catch (clientErr: any) {
    console.warn('[Firebase Backend] Client Firestore connection note:', clientErr?.message || clientErr);
  }

  // Option 3: In-memory fallback
  console.warn('[Firebase Backend] Using in-memory Firestore engine fallback.');
  return { firestore: globalFallbackStore, isMock: true };
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
  const path = reference?.path || reference?._key?.path?.segments?.join('/') || reference?.id || '';

  if (isFirestoreQuotaExhausted()) {
    if (path) {
      return globalFallbackStore.doc(path).get();
    }
    return { exists: false, data: () => undefined, id: reference?.id || '' };
  }

  try {
    const snap = typeof reference.get === 'function' ? await reference.get() : await clientGetDoc(reference);
    const isExisting = typeof snap.exists === 'function' ? snap.exists() : Boolean(snap.exists);
    const data = typeof snap.data === 'function' ? snap.data() : snap.data;
    if (isExisting && data && path) {
      void globalFallbackStore.doc(path).set(data, { merge: true });
    }
    return {
      id: snap.id,
      ref: snap.ref || reference,
      exists: isExisting,
      data: () => (typeof snap.data === 'function' ? snap.data() : snap.data),
      get: (fieldPath: string) => (typeof snap.get === 'function' ? snap.get(fieldPath) : data?.[fieldPath]),
    };
  } catch (err: any) {
    reportFirestoreError(err);
    if (path) {
      return globalFallbackStore.doc(path).get();
    }
    return { exists: false, data: () => undefined, id: reference?.id || '' };
  }
}

export async function getDocs(reference: any): Promise<any> {
  if (!reference) return { empty: true, size: 0, docs: [], forEach: () => {} };
  const path = reference?.path || reference?._key?.path?.segments?.join('/') || reference?.id || '';

  if (isFirestoreQuotaExhausted()) {
    if (path) {
      return globalFallbackStore.collection(path).get();
    }
    return { empty: true, size: 0, docs: [], forEach: () => {} };
  }

  try {
    const snap = typeof reference.get === 'function' ? await reference.get() : await clientGetDocs(reference);
    const rawDocs = snap.docs || [];
    const normalizedDocs = rawDocs.map((d: any) => {
      const isExisting = typeof d.exists === 'function' ? d.exists() : Boolean(d.exists);
      const data = typeof d.data === 'function' ? d.data() : d.data;
      if (path && d.id) {
        void globalFallbackStore.doc(path, d.id).set(data, { merge: true });
      }
      return {
        id: d.id,
        ref: d.ref,
        exists: isExisting,
        data: () => data,
        get: (fieldPath: string) => (typeof d.get === 'function' ? d.get(fieldPath) : data?.[fieldPath]),
      };
    });
    return {
      empty: normalizedDocs.length === 0,
      size: normalizedDocs.length,
      docs: normalizedDocs,
      forEach: (cb: (doc: any) => void) => normalizedDocs.forEach(cb),
    };
  } catch (err: any) {
    reportFirestoreError(err);
    if (path) {
      return globalFallbackStore.collection(path).get();
    }
    return { empty: true, size: 0, docs: [], forEach: () => {} };
  }
}

export async function setDoc(reference: any, data: any, options?: any): Promise<void> {
  const path = reference?.path || reference?._key?.path?.segments?.join('/') || reference?.id || '';
  if (path) {
    void globalFallbackStore.doc(path).set(data, options);
  }

  if (isFirestoreQuotaExhausted()) {
    return;
  }

  try {
    if (reference && typeof reference.set === 'function') {
      return await reference.set(data, options);
    }
    return await clientSetDoc(reference, data, options || {});
  } catch (err: any) {
    reportFirestoreError(err);
    console.warn('[Firestore setDoc] Cached write locally, cloud note:', err?.message || err);
  }
}

export async function deleteDoc(reference: any): Promise<void> {
  const path = reference?.path || reference?._key?.path?.segments?.join('/') || reference?.id || '';
  if (path) {
    void globalFallbackStore.doc(path).delete();
  }

  if (isFirestoreQuotaExhausted()) {
    return;
  }

  try {
    if (reference && typeof reference.delete === 'function') {
      return await reference.delete();
    }
    return await clientDeleteDoc(reference);
  } catch (err: any) {
    reportFirestoreError(err);
  }
}

export async function runTransaction<T>(
  firestore: any,
  updateFunction: (transaction: any) => Promise<T>,
): Promise<T> {
  if (isFirestoreQuotaExhausted()) {
    return globalFallbackStore.runTransaction(updateFunction);
  }
  try {
    if (firestore && typeof firestore.runTransaction === 'function') {
      return await firestore.runTransaction(updateFunction);
    }
    return await db.runTransaction(updateFunction);
  } catch (err: any) {
    reportFirestoreError(err);
    return globalFallbackStore.runTransaction(updateFunction);
  }
}

export function writeBatch(firestore: any): any {
  if (isFirestoreQuotaExhausted()) {
    return globalFallbackStore.batch();
  }
  try {
    if (firestore && typeof firestore.batch === 'function') {
      return firestore.batch();
    }
    return db.batch();
  } catch (err: any) {
    reportFirestoreError(err);
    return globalFallbackStore.batch();
  }
}

export function onSnapshot(reference: any, ...args: any[]): () => void {
  const onNext = args[0];
  const userOnError = typeof args[1] === 'function' ? args[1] : undefined;
  const path = reference?.path || reference?._key?.path?.segments?.join('/') || reference?.id || '';

  if (isFirestoreQuotaExhausted()) {
    if (typeof onNext === 'function' && path) {
      if (typeof reference?.get === 'function') {
        reference.get().then((res: any) => {
          try { onNext(res); } catch {}
        }).catch(() => {});
      } else {
        globalFallbackStore.doc(path).get().then((res: any) => {
          try { onNext(res); } catch {}
        }).catch(() => {});
      }
    }
    return () => {};
  }

  try {
    if (reference && typeof reference.onSnapshot === 'function') {
      return reference.onSnapshot(onNext, (err: any) => {
        reportFirestoreError(err);
        if (userOnError) {
          try { userOnError(err); } catch {}
        }
      });
    }

    const safeOnError = (err: any) => {
      reportFirestoreError(err);
      if (userOnError) {
        try { userOnError(err); } catch {}
      }
    };
    return clientOnSnapshot(reference, onNext, safeOnError);
  } catch (err: any) {
    reportFirestoreError(err);
    return () => {};
  }
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
