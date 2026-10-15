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

export function getNextFirebaseQuotaResetInfo(): {
  resetUtc: string;
  hoursRemaining: number;
  minutesRemaining: number;
  timeRemainingFormatted: string;
  nextResetTimestamp: number;
} {
  const now = new Date();
  // Firebase Firestore daily quotas reset at Midnight Pacific Time (00:00 PST / 08:00 UTC)
  const nextReset = new Date();
  nextReset.setUTCHours(8, 0, 0, 0); // 08:00 UTC = 00:00 PST
  if (nextReset.getTime() <= now.getTime()) {
    nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  }
  const diffMs = Math.max(0, nextReset.getTime() - now.getTime());
  const hoursRemaining = Math.floor(diffMs / (1000 * 60 * 60));
  const minutesRemaining = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  return {
    resetUtc: nextReset.toISOString(),
    hoursRemaining,
    minutesRemaining,
    timeRemainingFormatted: `${hoursRemaining}h ${minutesRemaining}m`,
    nextResetTimestamp: nextReset.getTime(),
  };
}

