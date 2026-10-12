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

function readServiceAccount(): Record<string, unknown> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is required for secure server-side Firestore access.',
    );
  }

  let serviceAccount: Record<string, unknown>;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.');
  }

  if (
    serviceAccount.project_id !== process.env.VITE_FIREBASE_PROJECT_ID &&
    serviceAccount.project_id !== process.env.FIREBASE_PROJECT_ID
  ) {
    throw new Error('Firebase service-account project does not match the configured Firebase project.');
  }
  if (typeof serviceAccount.client_email !== 'string' || typeof serviceAccount.private_key !== 'string') {
    throw new Error('Firebase service-account JSON is missing required credentials.');
  }
  return serviceAccount;
}

const serviceAccount = readServiceAccount();
const adminApp = getApps().length
  ? getApp()
  : initializeApp({
      credential: cert(serviceAccount as Parameters<typeof cert>[0]),
      projectId: String(serviceAccount.project_id),
    });

export const db = getFirestore(adminApp);

export function doc(firestore: Firestore, ...segments: string[]): DocumentReference<DocumentData> {
  return firestore.doc(segments.join('/')) as DocumentReference<DocumentData>;
}

export function collection(firestore: Firestore, ...segments: string[]): CollectionReference<DocumentData> {
  return firestore.collection(segments.join('/')) as CollectionReference<DocumentData>;
}

export function getDoc(reference: DocumentReference<DocumentData>): Promise<DocumentSnapshot<DocumentData>> {
  return reference.get();
}

export function getDocs(reference: Query<DocumentData>): Promise<QuerySnapshot<DocumentData>> {
  return reference.get();
}

export function setDoc(reference: any, data: any, options?: any): Promise<void> {
  return reference.set(data, options);
}

export function deleteDoc(reference: any): Promise<void> {
  return reference.delete();
}

export function runTransaction<T>(
  firestore: Firestore,
  updateFunction: (transaction: any) => Promise<T>,
): Promise<T> {
  return firestore.runTransaction(updateFunction);
}

export function writeBatch(firestore: Firestore): any {
  return firestore.batch();
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
  return reference.onSnapshot(...args);
}

export function serverTimestamp(): FieldValue {
  return FieldValue.serverTimestamp();
}
