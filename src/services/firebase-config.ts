const viteEnv = (import.meta as any)?.env ?? {};
const nodeEnv =
  typeof process !== 'undefined' ? process.env : ({} as Record<string, string | undefined>);

function readSetting(viteName: string, serverName: string, explicitValue: string): string {
  const value = viteEnv[viteName] ?? nodeEnv[viteName] ?? nodeEnv[serverName];
  if (typeof value === 'string' && value.trim() && !value.includes('solvatech-academy')) {
    return value.trim();
  }
  return explicitValue;
}

export const firebaseConfig = {
  apiKey: readSetting('VITE_FIREBASE_API_KEY', 'FIREBASE_API_KEY', 'AIzaSyDCVp_T6gO6HeTDeevls9MSb9quEzU5YiM'),
  authDomain: readSetting('VITE_FIREBASE_AUTH_DOMAIN', 'FIREBASE_AUTH_DOMAIN', 'solvatechbot.firebaseapp.com'),
  databaseURL: readSetting('VITE_FIREBASE_DATABASE_URL', 'FIREBASE_DATABASE_URL', 'https://solvatechbot-default-rtdb.firebaseio.com'),
  projectId: readSetting('VITE_FIREBASE_PROJECT_ID', 'FIREBASE_PROJECT_ID', 'solvatechbot'),
  storageBucket: readSetting('VITE_FIREBASE_STORAGE_BUCKET', 'FIREBASE_STORAGE_BUCKET', 'solvatechbot.firebasestorage.app'),
  messagingSenderId: readSetting(
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_MESSAGING_SENDER_ID',
    '1094113371408'
  ),
  appId: readSetting('VITE_FIREBASE_APP_ID', 'FIREBASE_APP_ID', '1:1094113371408:web:fdf3cbdef31413a703b195'),
};
