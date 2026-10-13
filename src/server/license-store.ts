import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LICENSES_STORE_PATH = path.resolve(__dirname, '../../.licenses_store.json');

export interface ServerLicenseRecord {
  key: string;
  planId: string;
  planName: string;
  durationDays: number;
  durationMinutes?: number;
  status: 'unclaimed' | 'active' | 'expired' | 'revoked';
  claimedBy?: string;
  claimedEmail?: string;
  claimedAt?: string;
  createdAt: string;
  expiresAt?: string;
}

function readStore(): Record<string, ServerLicenseRecord> {
  try {
    if (fs.existsSync(LICENSES_STORE_PATH)) {
      const raw = fs.readFileSync(LICENSES_STORE_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[LicenseStore] Failed to read .licenses_store.json:', err);
  }
  return {};
}

function writeStore(store: Record<string, ServerLicenseRecord>): void {
  try {
    fs.writeFileSync(LICENSES_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('[LicenseStore] Failed to write .licenses_store.json:', err);
  }
}

export function findLicenseByKey(key: string): ServerLicenseRecord | null {
  if (!key) return null;
  const store = readStore();
  const cleanKey = key.trim().toUpperCase();
  return store[cleanKey] || null;
}

export function saveLicenseRecord(record: ServerLicenseRecord): ServerLicenseRecord {
  const store = readStore();
  const cleanKey = record.key.trim().toUpperCase();
  const normalized: ServerLicenseRecord = {
    ...record,
    key: cleanKey,
    status: record.status || 'unclaimed',
    createdAt: record.createdAt || new Date().toISOString(),
  };
  store[cleanKey] = normalized;
  writeStore(store);
  return normalized;
}

export function saveBatchLicenseRecords(records: ServerLicenseRecord[]): ServerLicenseRecord[] {
  const store = readStore();
  const saved: ServerLicenseRecord[] = [];
  for (const r of records) {
    if (!r.key) continue;
    const cleanKey = r.key.trim().toUpperCase();
    const normalized: ServerLicenseRecord = {
      ...r,
      key: cleanKey,
      status: r.status || 'unclaimed',
      createdAt: r.createdAt || new Date().toISOString(),
    };
    store[cleanKey] = normalized;
    saved.push(normalized);
  }
  writeStore(store);
  return saved;
}

export function markLicenseRedeemed(
  key: string,
  userId: string,
  userEmail: string,
  expiresAt: string
): ServerLicenseRecord | null {
  const store = readStore();
  const cleanKey = key.trim().toUpperCase();
  const existing = store[cleanKey];
  if (!existing) return null;

  existing.status = 'active';
  existing.claimedBy = userId;
  existing.claimedEmail = userEmail.trim().toLowerCase();
  existing.claimedAt = new Date().toISOString();
  existing.expiresAt = expiresAt;

  store[cleanKey] = existing;
  writeStore(store);
  return existing;
}

export function getAllLicenseRecords(): ServerLicenseRecord[] {
  const store = readStore();
  return Object.values(store);
}

export function deleteLicenseRecord(key: string): boolean {
  const store = readStore();
  const cleanKey = key.trim().toUpperCase();
  if (store[cleanKey]) {
    delete store[cleanKey];
    writeStore(store);
    return true;
  }
  return false;
}

export function wipeUnusedLicenseRecords(): number {
  const store = readStore();
  let count = 0;
  for (const [k, v] of Object.entries(store)) {
    if (v.status === 'unclaimed' && !v.claimedBy) {
      delete store[k];
      count++;
    }
  }
  if (count > 0) {
    writeStore(store);
  }
  return count;
}

export function wipeExpiredLicenseRecords(): number {
  const store = readStore();
  const now = Date.now();
  let count = 0;
  for (const [k, v] of Object.entries(store)) {
    if (v.expiresAt) {
      const expMs = new Date(v.expiresAt).getTime();
      if (!isNaN(expMs) && expMs < now) {
        delete store[k];
        count++;
      }
    }
  }
  if (count > 0) {
    writeStore(store);
  }
  return count;
}

export function findActiveLicenseByUser(userId: string, userEmail?: string): ServerLicenseRecord | null {
  const store = readStore();
  const cleanEmail = (userEmail || '').trim().toLowerCase();
  const now = Date.now();
  let best: ServerLicenseRecord | null = null;
  let bestExp = 0;
  for (const record of Object.values(store)) {
    const matchesUser = (userId && record.claimedBy === userId) || (cleanEmail && record.claimedEmail?.toLowerCase() === cleanEmail);
    if (matchesUser && record.expiresAt) {
      const expMs = new Date(record.expiresAt).getTime();
      if (!isNaN(expMs) && expMs > now && expMs > bestExp) {
        best = record;
        bestExp = expMs;
      }
    }
  }
  return best;
}

