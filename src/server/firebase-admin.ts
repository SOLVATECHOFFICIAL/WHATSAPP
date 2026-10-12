import 'dotenv/config';
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  getFirestore,
  type Firestore,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from 'firebase-admin/firestore';

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

function initializeFirebaseAdmin(): { firestore: any; isMock: boolean } {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) {
    console.warn(
      '[Firebase Admin] FIREBASE_SERVICE_ACCOUNT_JSON not set. Active 24/7 in-memory Firestore engine ready for Railway/AI Studio.',
    );
    return { firestore: new InMemoryFirestore(), isMock: true };
  }

  try {
    const serviceAccount = JSON.parse(raw);
    if (
      typeof serviceAccount.client_email !== 'string' ||
      typeof serviceAccount.private_key !== 'string'
    ) {
      console.warn(
        '[Firebase Admin] FIREBASE_SERVICE_ACCOUNT_JSON credentials incomplete. Using in-memory fallback.',
      );
      return { firestore: new InMemoryFirestore(), isMock: true };
    }

    const projectId =
      String(serviceAccount.project_id || '') ||
      process.env.VITE_FIREBASE_PROJECT_ID ||
      process.env.FIREBASE_PROJECT_ID ||
      'solvatechbot';

    const adminApp = getApps().length
      ? getApp()
      : initializeApp({
          credential: cert(serviceAccount as Parameters<typeof cert>[0]),
          projectId,
        });

    return { firestore: getFirestore(adminApp), isMock: false };
  } catch (err: any) {
    console.warn(
      '[Firebase Admin] Could not initialize Firebase Admin SDK (' +
        err?.message +
        '). Using in-memory fallback.',
    );
    return { firestore: new InMemoryFirestore(), isMock: true };
  }
}

const { firestore: activeDb, isMock } = initializeFirebaseAdmin();

export const isFirebaseMock = isMock;
export const db: any = activeDb;

export function doc(firestore: any, ...segments: string[]): DocumentReference<DocumentData> {
  if (firestore && typeof firestore.doc === 'function') {
    const path = segments
      .flatMap((s) => s.split('/'))
      .filter(Boolean)
      .join('/');
    return firestore.doc(path);
  }
  return db.doc(...segments);
}

export function collection(firestore: any, ...segments: string[]): CollectionReference<DocumentData> {
  if (firestore && typeof firestore.collection === 'function') {
    const path = segments
      .flatMap((s) => s.split('/'))
      .filter(Boolean)
      .join('/');
    return firestore.collection(path);
  }
  return db.collection(...segments);
}

export function getDoc(reference: DocumentReference<DocumentData> | any): Promise<DocumentSnapshot<DocumentData>> {
  return reference.get();
}

export function getDocs(reference: Query<DocumentData> | CollectionReference<DocumentData> | any): Promise<QuerySnapshot<DocumentData>> {
  return reference.get();
}

export function setDoc(reference: any, data: any, options?: any): Promise<void> {
  return reference.set(data, options);
}

export function deleteDoc(reference: any): Promise<void> {
  return reference.delete();
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

export function onSnapshot(
  reference: Query<DocumentData>,
  onNext: (snapshot: QuerySnapshot<DocumentData>) => void,
  onError?: (error: Error) => void,
): () => void;
export function onSnapshot(
  reference: DocumentReference<DocumentData>,
  onNext: (snapshot: DocumentSnapshot<DocumentData>) => void,
  onError?: (error: Error) => void,
): () => void;
export function onSnapshot(reference: any, ...args: any[]): () => void {
  if (typeof reference.onSnapshot === 'function') {
    return reference.onSnapshot(...args);
  }
  return () => {};
}

export function serverTimestamp(): any {
  try {
    return FieldValue.serverTimestamp();
  } catch {
    return new Date().toISOString();
  }
}
