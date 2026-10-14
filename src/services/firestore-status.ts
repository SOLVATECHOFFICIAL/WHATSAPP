let firestoreQuotaExhaustedUntil = 0;

try {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    const cached = localStorage.getItem('solvatech_firestore_quota_until');
    if (cached) {
      const val = parseInt(cached, 10);
      if (val > Date.now()) {
        firestoreQuotaExhaustedUntil = val;
      }
    }
  }
} catch {}

export function isFirestoreQuotaExhausted(): boolean {
  return Date.now() < firestoreQuotaExhaustedUntil;
}

export function reportFirestoreError(err: any): void {
  if (!err) return;
  const msg = (err?.message || String(err || '')).toLowerCase();
  const code = String(err?.code || '').toLowerCase();
  const isQuota =
    code === 'resource-exhausted' ||
    code === '8' ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota exceeded') ||
    msg.includes('resource-exhausted') ||
    msg.includes('quota');

  if (isQuota) {
    firestoreQuotaExhaustedUntil = Math.max(
      firestoreQuotaExhaustedUntil,
      Date.now() + 15 * 60 * 1000,
    );
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(
          'solvatech_firestore_quota_until',
          String(firestoreQuotaExhaustedUntil),
        );
      }
    } catch {}
    console.warn(
      '[Firestore] Quota exceeded. Activating local cache fallback & offline backoff for 15 minutes.',
    );
  }
}

export function setFirestoreQuotaExhaustedFor(durationMs: number = 15 * 60 * 1000): void {
  firestoreQuotaExhaustedUntil = Math.max(
    firestoreQuotaExhaustedUntil,
    Date.now() + durationMs,
  );
  try {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.setItem(
        'solvatech_firestore_quota_until',
        String(firestoreQuotaExhaustedUntil),
      );
    }
  } catch {}
}

