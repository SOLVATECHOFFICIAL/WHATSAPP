// Client-side Browser Notification Service for SOLVATECH BOT
// Handles mandatory permission enforcement, expiry countdown alerts (30m, 15m, 5m),
// and admin panel action alerts (VIP Unlimited, +7 Days extension, revocation, free trial welcome).

export type NotificationPermissionStatus = 'default' | 'granted' | 'denied' | 'unsupported';

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermissionStatus {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission as NotificationPermissionStatus;
}

export async function requestNotificationPermission(): Promise<NotificationPermissionStatus> {
  if (!isNotificationSupported()) return 'unsupported';
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      try {
        new Notification('🔔 Notifications Enabled!', {
          body: 'You will receive instant alerts for license extensions, 30m/15m/5m expiry warnings, and admin upgrades.',
          icon: '/solva.webp',
        });
      } catch {}
    }
    return perm as NotificationPermissionStatus;
  } catch (err) {
    console.warn('Error requesting notification permission:', err);
    return Notification.permission as NotificationPermissionStatus;
  }
}

export function sendBrowserNotification(
  title: string,
  options?: {
    body?: string;
    icon?: string;
    badge?: string;
    tag?: string;
    data?: any;
    requireInteraction?: boolean;
  }
): boolean {
  if (!isNotificationSupported()) return false;
  if (Notification.permission !== 'granted') return false;

  try {
    const notif = new Notification(title, {
      icon: options?.icon || '/solva.webp',
      badge: options?.badge || '/solva.webp',
      body: options?.body || '',
      tag: options?.tag || `solvatech_${Date.now()}`,
      requireInteraction: options?.requireInteraction ?? false,
      ...options,
    });

    notif.onclick = () => {
      window.focus();
      notif.close();
    };

    return true;
  } catch (err) {
    console.debug('Browser notification note:', err);
    return false;
  }
}

// Memory tracker to prevent duplicate alerts for the same expiry timestamp
const firedAlerts = new Set<string>();

/**
 * Checks remaining time and fires 30-min, 15-min, 5-min, and expired alerts
 * Strictly ensures each alert is dispatched only once per expiration cycle.
 */
export function checkAndDispatchExpiryWarnings(
  expiresAt: string | null | undefined,
  isUnlimited: boolean | undefined,
  onToast?: (title: string, body: string, type?: 'warning' | 'error' | 'success' | 'info') => void
) {
  if (isUnlimited || !expiresAt) return;

  const expMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expMs) || expMs <= 0) return;

  const now = Date.now();
  const diffMs = expMs - now;
  const expKey = `${expiresAt}_${Math.floor(expMs / 1000)}`;

  // 1. 30 Minutes Remaining Warning (between 28m and 30m)
  const key30m = `alert_30m_${expKey}`;
  if (diffMs > 0 && diffMs <= 30 * 60 * 1000 && diffMs > 25 * 60 * 1000 && !firedAlerts.has(key30m)) {
    firedAlerts.add(key30m);
    const title = '⚠️ License Warning: 30 Minutes Remaining';
    const body = 'Your bot license will expire in 30 minutes! Renew your key now to prevent bot disconnection.';
    sendBrowserNotification(title, { body, tag: 'lic_30m', requireInteraction: true });
    onToast?.(title, body, 'warning');
  }

  // 2. 15 Minutes Remaining Warning (between 13m and 15m)
  const key15m = `alert_15m_${expKey}`;
  if (diffMs > 0 && diffMs <= 15 * 60 * 1000 && diffMs > 10 * 60 * 1000 && !firedAlerts.has(key15m)) {
    firedAlerts.add(key15m);
    const title = '⚠️ Urgent: 15 Minutes Remaining';
    const body = 'Only 15 minutes left on your license! Bot will disconnect automatically when timer hits zero.';
    sendBrowserNotification(title, { body, tag: 'lic_15m', requireInteraction: true });
    onToast?.(title, body, 'warning');
  }

  // 3. 5 Minutes Remaining Critical Warning (between 0m and 5m)
  const key5m = `alert_5m_${expKey}`;
  if (diffMs > 0 && diffMs <= 5 * 60 * 1000 && !firedAlerts.has(key5m)) {
    firedAlerts.add(key5m);
    const title = '🚨 Critical: 5 Minutes Remaining!';
    const body = 'Bot disconnection imminent in 5 minutes! Redeem a license key immediately to avoid interruption.';
    sendBrowserNotification(title, { body, tag: 'lic_5m', requireInteraction: true });
    onToast?.(title, body, 'error');
  }

  // 4. Expired Alert
  const keyExpired = `alert_expired_${expKey}`;
  if (diffMs <= 0 && !firedAlerts.has(keyExpired)) {
    firedAlerts.add(keyExpired);
    const title = '❌ Bot License Expired';
    const body = 'Your bot license duration has ended. Redeem a new key on the dashboard to reactivate 24/7 automation.';
    sendBrowserNotification(title, { body, tag: 'lic_expired', requireInteraction: true });
    onToast?.(title, body, 'error');
  }
}

/**
 * Dispatches notification when Admin performs action on user account
 */
export function notifyAdminAction(
  actionType: 'unlimited_granted' | 'days_added' | 'revoked',
  detail: { days?: number; newExpiresAt?: string },
  onToast?: (title: string, body: string, type?: 'warning' | 'error' | 'success' | 'info') => void
) {
  if (actionType === 'unlimited_granted') {
    const title = '👑 Unlimited VIP License Activated!';
    const body = 'The administrator has granted your account permanent Lifetime Unlimited Bot Access!';
    sendBrowserNotification(title, { body, tag: 'admin_unlimited', requireInteraction: true });
    onToast?.(title, body, 'success');
  } else if (actionType === 'days_added') {
    const days = detail.days || 7;
    const title = `⏳ License Extended (+${days} Days)!`;
    const body = `Administrator added +${days} Days to your bot account. Your timer has been stacked!`;
    sendBrowserNotification(title, { body, tag: 'admin_days_added', requireInteraction: true });
    onToast?.(title, body, 'success');
  } else if (actionType === 'revoked') {
    const title = '⚠️ Bot License Updated';
    const body = 'Your bot access was terminated or revoked by the administrator.';
    sendBrowserNotification(title, { body, tag: 'admin_revoked', requireInteraction: true });
    onToast?.(title, body, 'error');
  }
}

/**
 * Dispatches welcome free trial notification
 */
export function notifyWelcomeFreeTrial(
  onToast?: (title: string, body: string, type?: 'warning' | 'error' | 'success' | 'info') => void
) {
  const title = '🎁 Welcome to SOLVATECH BOT!';
  const body = 'Your 30-Minute Free Trial is now ACTIVE. Pair your WhatsApp number to test all 35+ commands!';
  sendBrowserNotification(title, { body, tag: 'welcome_free_trial', requireInteraction: true });
  onToast?.(title, body, 'info');
}
