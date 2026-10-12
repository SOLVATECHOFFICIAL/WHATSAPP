const viteEnv = (import.meta as any)?.env ?? {};
const nodeEnv =
  typeof process !== 'undefined' ? process.env : ({} as Record<string, string | undefined>);

function readSetting(viteName: string, serverName: string): string {
  const value = viteEnv[viteName] ?? nodeEnv[viteName] ?? nodeEnv[serverName];
  return typeof value === 'string' ? value.trim() : '';
}

export const firebaseConfig = {
  apiKey: readSetting('VITE_FIREBASE_API_KEY', 'FIREBASE_API_KEY'),
  authDomain: readSetting('VITE_FIREBASE_AUTH_DOMAIN', 'FIREBASE_AUTH_DOMAIN'),
  databaseURL: readSetting('VITE_FIREBASE_DATABASE_URL', 'FIREBASE_DATABASE_URL'),
  projectId: readSetting('VITE_FIREBASE_PROJECT_ID', 'FIREBASE_PROJECT_ID'),
  storageBucket: readSetting('VITE_FIREBASE_STORAGE_BUCKET', 'FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: readSetting(
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_MESSAGING_SENDER_ID',
  ),
  appId: readSetting('VITE_FIREBASE_APP_ID', 'FIREBASE_APP_ID'),
};
