let firestoreQuotaExhaustedUntil = 0;

export function isFirestoreQuotaExhausted(): boolean {
  return Date.now() < firestoreQuotaExhaustedUntil;
}

export function reportFirestoreError(err: any): void {
  const msg = err?.message || String(err || '');
  const code = err?.code || '';
  if (
    code === 'resource-exhausted' ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('Quota exceeded')
  ) {
    firestoreQuotaExhaustedUntil = Math.max(
      firestoreQuotaExhaustedUntil,
      Date.now() + 15 * 60 * 1000,
    );
    console.warn(
      '[Firestore] Quota exceeded. Activating local cache fallback & offline backoff for 15 minutes.',
    );
  }
}
