import { useState, useEffect, useRef } from 'react';
import {
  Smartphone,
  CheckCircle2,
  Copy,
  Check,
  RefreshCw,
  KeyRound,
  LogOut,
  Radio,
  Clock,
  Zap,
  Key,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
  Terminal,
  Search,
  Bell,
  Mail,
  Lock,
  User as UserIcon,
  ArrowRight,
  Trash2,
  Crown,
  Shield,
  Sparkles,
  Gift,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  db,
  onAuthChange,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  syncUserProfile,
  isFirestoreQuotaExhausted,
  reportFirestoreError,
} from './services/firebase';
import { NotificationBanner } from './components/NotificationBanner';
import {
  checkAndDispatchExpiryWarnings,
  notifyAdminAction,
  notifyWelcomeFreeTrial,
} from './services/notification-service';
import { COUNTRIES, Country } from './data/countries';
import { CountrySelect } from './components/CountrySelect';
import { AuthModal } from './components/AuthModal';
import { UserAccountNav } from './components/UserAccountNav';
import { AdminDashboard } from './components/AdminDashboard';
import { GroupAdminPanel } from './components/GroupAdminPanel';
import { LicenseCountdown } from './components/LicenseCountdown';
import { PairingCountdown } from './components/PairingCountdown';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import {
  NotificationsPanel,
  WhatsAppNotification,
} from './components/NotificationsPanel';
import {
  OWNER_EMAIL,
  isOwnerEmail,
  calculateRemainingTime,
  redeemKey,
  checkUserTrialStatus,
  claim30MinuteTrial,
  LICENSE_PLANS,
  PAYMENT_INFO,
} from './services/license';

interface WhatsAppStatus {
  state: 'disconnected' | 'connecting' | 'awaiting_pairing' | 'pairing_handshake' | 'connected' | 'expired';
  isConnected: boolean;
  isPaired?: boolean;
  pairingStage: 'idle' | 'code_generated' | 'pairing_handshake' | 'connected' | 'expired';
  pairingCode?: string;
  qrCodeUrl?: string;
  targetPhone?: string;
  uptime?: number;
  lastError?: string;
  latestHandshakeTime?: string;
  isExpired?: boolean;
  licenseExpiresAt?: string | null;
  reconnectRemainingSeconds?: number | null;
  user?: {
    id: string;
    name?: string;
    phone?: string;
  };
}

export async function safeParseJson<T = any>(res: Response | null | undefined): Promise<T | null> {
  if (!res) return null;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json') && !contentType.includes('+json')) return null;
  try {
    const raw = await res.text();
    if (!raw || raw.trim().startsWith('<')) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function sameWhatsAppStatus(a: WhatsAppStatus, b: WhatsAppStatus): boolean {
  return (
    a.state === b.state &&
    a.isConnected === b.isConnected &&
    a.isPaired === b.isPaired &&
    a.pairingStage === b.pairingStage &&
    a.pairingCode === b.pairingCode &&
    a.qrCodeUrl === b.qrCodeUrl &&
    a.targetPhone === b.targetPhone &&
    a.lastError === b.lastError &&
    a.isExpired === b.isExpired &&
    a.licenseExpiresAt === b.licenseExpiresAt &&
    a.reconnectRemainingSeconds === b.reconnectRemainingSeconds &&
    a.user?.id === b.user?.id &&
    a.user?.name === b.user?.name &&
    a.user?.phone === b.user?.phone
  );
}

export function sendDeviceNotification(title: string, body: string, icon = '/solva.webp') {
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon });
    } catch {
      if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(title, { body, icon });
        }).catch(() => {});
      }
    }
  }
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<WhatsAppNotification[]>([]);
  const [toastNotification, setToastNotification] = useState<WhatsAppNotification | null>(null);

  // Sign-in gateway mode for unauthenticated users
  const [authMode, setAuthMode] = useState<'google' | 'signup' | 'login'>('google');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [domainError, setDomainError] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState(false);

  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';

  const copyDomain = () => {
    if (typeof window !== 'undefined' && currentHost) {
      navigator.clipboard.writeText(currentHost);
      setCopiedDomain(true);
      setTimeout(() => setCopiedDomain(false), 2500);
    }
  };

  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0]); // Default Nigeria 🇳🇬 (+234)
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'pair' | 'groups' | 'license' | 'commands'>('pair');

  const [status, setStatus] = useState<WhatsAppStatus>({
    state: 'disconnected',
    isConnected: false,
    pairingStage: 'idle',
  });
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairMethod, setPairMethod] = useState<'code' | 'qr'>('code');
  const [qrLoading, setQrLoading] = useState(false);

  // License state with time stacking
  const [userLicenseData, setUserLicenseData] = useState<{
    expiresAt: string | null;
    isUnlimited: boolean;
    plan: string;
    key: string | null;
  }>({
    expiresAt: null,
    isUnlimited: false,
    plan: 'Trial',
    key: null,
  });

  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [inTabKeyInput, setInTabKeyInput] = useState('');
  const [inTabRedeeming, setInTabRedeeming] = useState(false);
  const [inTabSuccess, setInTabSuccess] = useState<string | null>(null);
  const [inTabError, setInTabError] = useState<string | null>(null);
  const [commandSearch, setCommandSearch] = useState('');

  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);

  // User Reconnect State (tries for 1 minute to old WhatsApp with live countdown)
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectSecondsLeft, setReconnectSecondsLeft] = useState(0);
  const [reconnectFeedback, setReconnectFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    reason?: string;
  } | null>(null);

  // 30-Minute Free Test (Once in a Lifetime) state
  const [hasClaimedTrial, setHasClaimedTrial] = useState(false);
  const [claimingTrial, setClaimingTrial] = useState(false);
  const [trialMessage, setTrialMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // User Dashboard: Anti-Delete Message Recovery state (isolated per user)
  const [antiDeleteEnabled, setAntiDeleteEnabled] = useState(true);
  const [togglingAntiDelete, setTogglingAntiDelete] = useState(false);

  const fetchAntiDeleteStatus = async (uid?: string) => {
    const targetUid = uid || currentUser?.uid;
    if (!targetUid) return;
    try {
      const res = await fetch(`/api/user/anti-delete?userId=${encodeURIComponent(targetUid)}`).catch(() => null);
      if (res && res.ok) {
        const data = await safeParseJson<{ success: boolean; enabled: boolean }>(res);
        if (data && typeof data.enabled === 'boolean') {
          setAntiDeleteEnabled(data.enabled);
        }
      }
    } catch (err) {
      console.error('Failed to fetch anti-delete status:', err);
    }
  };

  const handleToggleAntiDelete = async () => {
    if (!currentUser?.uid) return;
    const nextValue = !antiDeleteEnabled;
    setTogglingAntiDelete(true);
    setAntiDeleteEnabled(nextValue); // Optimistic UI update

    try {
      const res = await fetch('/api/user/anti-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextValue, userId: currentUser.uid }),
      });

      if (res.ok) {
        setToastNotification({
          id: 'antidel_' + Date.now(),
          type: 'system',
          title: nextValue ? '🚨 Anti-Delete Recovery Active' : '⚪ Anti-Delete Turned Off',
          body: nextValue
            ? 'All deleted messages from anywhere will instantly flood directly into your personal WhatsApp DM chat!'
            : 'Anti-delete recovery is disabled. Deleted messages will be ignored.',
          timestamp: new Date().toLocaleTimeString(),
        });
        setTimeout(() => setToastNotification(null), 4000);
      } else {
        // Revert on failure
        setAntiDeleteEnabled(!nextValue);
      }
    } catch (err) {
      console.error('Anti-delete toggle error:', err);
      setAntiDeleteEnabled(!nextValue);
    } finally {
      setTogglingAntiDelete(false);
    }
  };

  // STRICT RULE: Authorized owner/admin check
  const isOwner = Boolean(
    currentUser?.email && isOwnerEmail(currentUser.email)
  );

  // Manual status refresh: forces immediate fetch from backend for current user
  const handleRefreshStatus = async () => {
    if (!currentUser?.uid) return;
    setIsRefreshingStatus(true);
    try {
      const userEmailParam = currentUser.email ? `&userEmail=${encodeURIComponent(currentUser.email)}` : '';
      const [resStatus, resNotifs] = await Promise.all([
        fetch(`/api/whatsapp/status?userId=${encodeURIComponent(currentUser.uid)}${userEmailParam}`, {
          headers: { 'x-user-email': currentUser.email || '' },
        }).catch(() => null),
        fetch(`/api/whatsapp/notifications?userId=${encodeURIComponent(currentUser.uid)}`).catch(() => null),
        fetchAntiDeleteStatus(currentUser.uid),
      ]);

      const data = await safeParseJson(resStatus);
      if (data?.status) {
        setStatus((previous) =>
          sameWhatsAppStatus(previous, data.status) ? previous : data.status
        );
        if (data.status.isConnected || data.status.state === 'connected' || data.status.pairingStage === 'connected') {
          setPairingCode(null);
        } else if (data.status.pairingCode) {
          setPairingCode(data.status.pairingCode);
        }
      }

      const dataNotifs = await safeParseJson(resNotifs);
      if (dataNotifs && Array.isArray(dataNotifs.notifications)) {
        setNotifications(dataNotifs.notifications);
      }

      setToastNotification({
        id: 'refreshed_' + Date.now(),
        type: 'system',
        title: 'Status Synchronized 🟢',
        body: 'WhatsApp connection state is completely up to date with server.',
        timestamp: new Date().toLocaleTimeString(),
      });
      setTimeout(() => setToastNotification(null), 3500);
    } catch (e) {
      console.error('Refresh status error:', e);
    } finally {
      setIsRefreshingStatus(false);
    }
  };

  // Track previous license state to trigger notifications on admin actions
  const prevLicenseStateRef = useRef<{ isUnlimited?: boolean; expiresAt?: string | null; status?: string }>({});

  // Listen to Auth State and real-time Firestore license sync
  // Zero property leakage: switching accounts completely resets state before fetching the new account's data
  useEffect(() => {
    let currentDocUnsub: (() => void) | null = null;

    const unsubscribeAuth = onAuthChange((user) => {
      // Clean up previous user snapshot listener
      if (currentDocUnsub) {
        currentDocUnsub();
        currentDocUnsub = null;
      }

      // Reset all user-specific state immediately so no properties leak across accounts
      setPairingCode(null);
      setPhoneNumber('');
      setPairingError(null);
      setStatus({
        state: 'disconnected',
        isConnected: false,
        pairingStage: 'idle',
      });
      setNotifications([]);
      setUserLicenseData({
        expiresAt: null,
        isUnlimited: false,
        plan: 'Trial',
        key: null,
      });

      setCurrentUser(user);
      setAuthLoading(false);

      if (user) {
        // Immediately sync user profile to ensure Firestore doc exists & auto-tether 30-min trial for new users
        syncUserProfile(user).then((res) => {
          if (res?.isNewUser) {
            notifyWelcomeFreeTrial((title, body) => {
              setToastNotification({
                id: 'welcome_' + Date.now(),
                type: 'system',
                title,
                body,
                timestamp: new Date().toLocaleTimeString(),
              });
            });
            if (res.trialExpiresAt) {
              setHasClaimedTrial(true);
              setUserLicenseData((prev) => ({
                ...prev,
                expiresAt: res.trialExpiresAt,
                plan: '⚡ 30-Minute Free Trial (Active)',
                isUnlimited: false,
              }));
            }
          }
        }).catch(() => {});

        // Check local storage immediately for zero-flicker UI
        try {
          const isLocallyClaimed =
            localStorage.getItem(`solvatech_trial_claimed_${user.uid}`) === 'true' ||
            Boolean(user.email && localStorage.getItem(`solvatech_trial_claimed_${user.email.toLowerCase()}`) === 'true');
          if (isLocallyClaimed) {
            setHasClaimedTrial(true);
          }
          const cachedExpiry =
            localStorage.getItem(`solvatech_license_expiresAt_${user.uid}`) ||
            (user.email ? localStorage.getItem(`solvatech_license_expiresAt_${user.email.toLowerCase()}`) : null);
          if (cachedExpiry && new Date(cachedExpiry).getTime() > Date.now()) {
            setUserLicenseData((prev) => ({
              ...prev,
              expiresAt: cachedExpiry,
              plan: 'Active Access',
              isUnlimited: false,
            }));
          }
        } catch {}

        // Query authoritative trial status and active expiration for this specific account
        fetch(`/api/trial/status?uid=${encodeURIComponent(user.uid)}&email=${encodeURIComponent(user.email || '')}`)
          .then((r) => r.json())
          .then((data) => {
            if (data?.success) {
              const isClaimed = Boolean(data.hasClaimedTrial ?? data.hasUsedTrial);
              if (isClaimed) {
                setHasClaimedTrial(true);
                try {
                  localStorage.setItem(`solvatech_trial_claimed_${user.uid}`, 'true');
                  if (user.email) localStorage.setItem(`solvatech_trial_claimed_${user.email.toLowerCase()}`, 'true');
                } catch {}
              }
              if (data.isActive && data.expiresAt) {
                try {
                  localStorage.setItem(`solvatech_license_expiresAt_${user.uid}`, data.expiresAt);
                  if (user.email) localStorage.setItem(`solvatech_license_expiresAt_${user.email.toLowerCase()}`, data.expiresAt);
                } catch {}
                setUserLicenseData((prev) => ({
                  ...prev,
                  expiresAt: data.expiresAt,
                  plan: '⚡ 30-Minute Test (Active)',
                  isUnlimited: false,
                }));
              }
            }
          })
          .catch(() => {
            checkUserTrialStatus(user.uid, user.email).then((claimed) => {
              if (claimed) setHasClaimedTrial(true);
            });
          });

        // Real-time Firestore sync
        try {
          if (!isFirestoreQuotaExhausted() && db && (db as any).app) {
            currentDocUnsub = onSnapshot(
              doc(db, 'users', user.uid),
              (snap) => {
                if (snap.exists()) {
                  const data = snap.data();
                  if (data.hasUsedTrial === true || data.lifetimeTrialLocked === true || data.trialClaimedAt) {
                    setHasClaimedTrial(true);
                    try {
                      localStorage.setItem(`solvatech_trial_claimed_${user.uid}`, 'true');
                      if (user.email) localStorage.setItem(`solvatech_trial_claimed_${user.email.toLowerCase()}`, 'true');
                    } catch {}
                  }

                  const isUserUnlimited = isOwner || Boolean(data.isUnlimited) || data.licenseStatus === 'unlimited' || Boolean(data.licensePlan?.includes('Unlimited'));

                  // Detect Admin actions and dispatch notifications
                  const prevLic = prevLicenseStateRef.current;
                  const newExp = data.licenseExpiresAt || null;
                  const newExpMs = newExp ? new Date(newExp).getTime() : 0;
                  const prevExpMs = prevLic.expiresAt ? new Date(prevLic.expiresAt).getTime() : 0;

                  // 1. Admin granted unlimited
                  if (prevLic.isUnlimited === false && isUserUnlimited) {
                    notifyAdminAction('unlimited_granted', {}, (title, body) => {
                      setToastNotification({
                        id: 'admin_unlim_' + Date.now(),
                        type: 'system',
                        title,
                        body,
                        timestamp: new Date().toLocaleTimeString(),
                      });
                    });
                  }
                  // 2. Admin added days (forward extension >= 23 hours)
                  else if (!isUserUnlimited && prevExpMs > 0 && newExpMs > prevExpMs + 23 * 3600 * 1000) {
                    const daysAdded = Math.round((newExpMs - prevExpMs) / (24 * 3600 * 1000));
                    notifyAdminAction('days_added', { days: daysAdded, newExpiresAt: newExp }, (title, body) => {
                      setToastNotification({
                        id: 'admin_days_' + Date.now(),
                        type: 'system',
                        title,
                        body,
                        timestamp: new Date().toLocaleTimeString(),
                      });
                    });
                  }
                  // 3. Admin revoked/terminated
                  else if (prevExpMs > Date.now() && (data.licenseStatus === 'expired' || data.licensePlan?.includes('Revoked') || data.licensePlan?.includes('Terminated'))) {
                    notifyAdminAction('revoked', {}, (title, body) => {
                      setToastNotification({
                        id: 'admin_rev_' + Date.now(),
                        type: 'system',
                        title,
                        body,
                        timestamp: new Date().toLocaleTimeString(),
                      });
                    });
                  }

                  prevLicenseStateRef.current = {
                    isUnlimited: isUserUnlimited,
                    expiresAt: newExp,
                    status: data.licenseStatus,
                  };

                  setUserLicenseData((prev) => {
                    const now = Date.now();
                    const prevExpMs = prev.expiresAt ? new Date(prev.expiresAt).getTime() : 0;
                    const newExpMs = data.licenseExpiresAt ? new Date(data.licenseExpiresAt).getTime() : 0;
                    let localExpMs = 0;
                    try {
                      const lExp = localStorage.getItem(`solvatech_license_expiresAt_${user.uid}`) ||
                        (user.email ? localStorage.getItem(`solvatech_license_expiresAt_${user.email.toLowerCase()}`) : null);
                      if (lExp) localExpMs = new Date(lExp).getTime();
                    } catch {}

                    let finalExpiresAt = isUserUnlimited ? null : (data.licenseExpiresAt || null);
                    let finalPlan = isUserUnlimited ? '👑 Unlimited Lifetime (Admin Granted)' : (data.licensePlan || 'Active Plan');

                    // If current active countdown is still running and snapshot has null/older, retain the active countdown
                    if (!isUserUnlimited) {
                      if (prevExpMs > now && (!newExpMs || newExpMs < prevExpMs)) {
                        finalExpiresAt = prev.expiresAt;
                        finalPlan = prev.plan;
                      } else if (localExpMs > now && (!newExpMs || newExpMs < localExpMs)) {
                        finalExpiresAt = new Date(localExpMs).toISOString();
                      }
                    }

                    if (finalExpiresAt && new Date(finalExpiresAt).getTime() > now) {
                      try {
                        localStorage.setItem(`solvatech_license_expiresAt_${user.uid}`, finalExpiresAt);
                        if (user.email) localStorage.setItem(`solvatech_license_expiresAt_${user.email.toLowerCase()}`, finalExpiresAt);
                      } catch {}
                    }

                    return {
                      expiresAt: finalExpiresAt,
                      isUnlimited: isUserUnlimited,
                      plan: isUserUnlimited ? '👑 Unlimited Lifetime (Admin Granted)' : finalPlan,
                      key: data.licenseKey || prev.key || null,
                    };
                  });
                }
              },
              (err) => {
                reportFirestoreError(err);
                const uEmail = user.email ? `&userEmail=${encodeURIComponent(user.email)}` : '';
                fetch(`/api/whatsapp/status?userId=${encodeURIComponent(user.uid)}${uEmail}`, {
                  headers: { 'x-user-email': user.email || '' },
                })
                  .then((r) => r.json())
                  .then((st) => {
                    if (st?.status?.licenseExpiresAt) {
                      setUserLicenseData((prev) => ({
                        ...prev,
                        expiresAt: st.status.licenseExpiresAt,
                      }));
                    }
                  })
                  .catch(() => {});
              }
            );
          }
        } catch (e) {
          reportFirestoreError(e);
          console.debug('Firestore user listener note:', e);
        }
      } else {
        // Clean account reset on logout
        setHasClaimedTrial(false);
        setAntiDeleteEnabled(true);
      }
    });

    return () => {
      unsubscribeAuth();
      if (currentDocUnsub) {
        currentDocUnsub();
      }
    };
  }, []);

  // Sync active license state to server 24/7 heartbeat watchdog per user session
  useEffect(() => {
    if (currentUser?.uid && (userLicenseData.expiresAt || isOwner || userLicenseData.isUnlimited)) {
      const requestStartedAt = Date.now();
      fetch('/api/whatsapp/sync-license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.uid,
          userEmail: currentUser.email,
          expiresAt: userLicenseData.expiresAt,
          isUnlimited: isOwner || userLicenseData.isUnlimited,
        }),
      }).then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        const serverMs = Date.parse(data.serverTime);
        if (Number.isFinite(serverMs)) {
          const responseReceivedAt = Date.now();
          const midpoint = (requestStartedAt + responseReceivedAt) / 2;
          setServerClockOffsetMs(serverMs - midpoint);
        }
      }).catch(() => {});
    }
  }, [userLicenseData.expiresAt, userLicenseData.isUnlimited, isOwner, currentUser?.uid, currentUser?.email]);

  // License Expiry Watchdog (dispatches 30m, 15m, 5m, and Expired alerts via Browser Notification & In-App Toast)
  useEffect(() => {
    if (!currentUser || userLicenseData.isUnlimited || !userLicenseData.expiresAt) return;
    const checkExpiry = () => {
      checkAndDispatchExpiryWarnings(userLicenseData.expiresAt, userLicenseData.isUnlimited, (title, body) => {
        setToastNotification({
          id: 'expiry_alert_' + Date.now(),
          type: 'system',
          title,
          body,
          timestamp: new Date().toLocaleTimeString(),
        });
      });
    };
    checkExpiry();
    const timer = setInterval(checkExpiry, 10000);
    return () => clearInterval(timer);
  }, [userLicenseData.expiresAt, userLicenseData.isUnlimited, currentUser?.uid]);

  // Polling backend status and real-time notifications (isolated per user account)
  const isPairingActive =
    Boolean(pairingCode) ||
    status.pairingStage === 'code_generated' ||
    status.pairingStage === 'pairing_handshake' ||
    status.state === 'awaiting_pairing';

  useEffect(() => {
    if (!currentUser?.uid) {
      return;
    }

    const userId = currentUser.uid;
    fetchAntiDeleteStatus(userId);

    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const fetchData = async () => {
      try {
        const curEmail = currentUser?.email || '';
        const emailParam = curEmail ? `&userEmail=${encodeURIComponent(curEmail)}` : '';
        const [resStatus, resNotifs] = await Promise.all([
          fetch(`/api/whatsapp/status?userId=${encodeURIComponent(userId)}${emailParam}`, {
            headers: { 'x-user-email': curEmail },
          }).catch(() => null),
          fetch(`/api/whatsapp/notifications?userId=${encodeURIComponent(userId)}`).catch(() => null),
        ]);
        if (stopped) return;

        const data = await safeParseJson(resStatus);
        if (data?.status) {
          setStatus((previous) => {
            if (!previous.isConnected && data.status.isConnected) {
              const phoneText = data.status.user?.phone || '';
              setToastNotification({
                id: 'conn_' + Date.now(),
                type: 'connection',
                title: 'WhatsApp Connected Successfully! 🟢',
                body: `Your phone ${phoneText} is now paired and online 24/7!`,
                timestamp: new Date().toLocaleTimeString(),
              });
              sendDeviceNotification('WhatsApp Connected! 🟢', `SOLVATECH bot paired with ${phoneText} and active 24/7.`);
              setTimeout(() => setToastNotification(null), 6000);
            }
            return sameWhatsAppStatus(previous, data.status) ? previous : data.status;
          });
          if (data.status.isConnected || data.status.state === 'connected' || data.status.pairingStage === 'connected') {
            setPairingCode(null);
          } else if (data.status.pairingCode) {
            setPairingCode(data.status.pairingCode);
          }
        }

        const dataNotifs = await safeParseJson(resNotifs);
        if (dataNotifs && Array.isArray(dataNotifs.notifications)) {
          setNotifications((prev) => {
            if (
              prev.length === dataNotifs.notifications.length &&
              prev.every((notification, index) => notification.id === dataNotifs.notifications[index]?.id)
            ) {
              return prev;
            }
            if (prev.length > 0 && dataNotifs.notifications.length > prev.length) {
              const newest = dataNotifs.notifications[0];
              if (newest && newest.id !== prev[0]?.id) {
                setToastNotification(newest);
                sendDeviceNotification(newest.title, newest.body);
                setTimeout(() => setToastNotification(null), 5000);
              }
            }
            return dataNotifs.notifications;
          });
        }
      } catch (err) {
        console.debug('Polling WhatsApp note (offline resilient):', err);
      } finally {
        if (!stopped) {
          timer = setTimeout(fetchData, isPairingActive ? 4000 : 15000);
        }
      }
    };

    void fetchData();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [currentUser?.uid, isPairingActive]);

  // Tab visibility change: auto-refresh status when user switches back from WhatsApp
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && currentUser?.uid) {
        const uEmail = currentUser.email ? `&userEmail=${encodeURIComponent(currentUser.email)}` : '';
        fetch(`/api/whatsapp/status?userId=${encodeURIComponent(currentUser.uid)}${uEmail}`, {
          headers: { 'x-user-email': currentUser.email || '' },
        })
          .then((r) => safeParseJson(r))
          .then((data) => {
            if (data?.status) {
              setStatus((previous) =>
                sameWhatsAppStatus(previous, data.status) ? previous : data.status
              );
              if (data.status.isConnected || data.status.state === 'connected' || data.status.pairingStage === 'connected') {
                setPairingCode(null);
              } else if (data.status.pairingCode) {
                setPairingCode(data.status.pairingCode);
              }
            }
          })
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [currentUser?.uid]);

  // Handle URL hash, query param, keyboard shortcut, and typing 'admin dashboard' (Owner only)
  useEffect(() => {
    if (!isOwner) return;

    const checkHash = () => {
      if (
        window.location.hash === '#admin' ||
        window.location.hash === '#admin-dashboard' ||
        window.location.search.includes('view=admin') ||
        window.location.search.includes('admin=true')
      ) {
        setIsAdminModalOpen(true);
      }
    };
    checkHash();
    window.addEventListener('hashchange', checkHash);

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.altKey && e.key.toLowerCase() === 'a') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a')) {
        e.preventDefault();
        setIsAdminModalOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('hashchange', checkHash);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOwner]);

  // When owner types 'admin dashboard' into command search, auto-launch
  useEffect(() => {
    if (!isOwner) return;
    const clean = commandSearch.trim().toLowerCase();
    if (clean === 'admin dashboard' || clean === 'open admin' || clean === '/admin' || clean === 'admin os') {
      setIsAdminModalOpen(true);
    }
  }, [commandSearch, isOwner]);

  // Clear live notifications
  const handleClearNotifications = async () => {
    if (!currentUser?.uid) return;
    try {
      await fetch(`/api/whatsapp/notifications?userId=${encodeURIComponent(currentUser.uid)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.uid }),
      });
      setNotifications([]);
    } catch (e) {
      console.error('Failed to clear notifications:', e);
    }
  };

  // Google Sign-In handler (Primary first action)
  const handleGoogleSignInFirst = async () => {
    setAuthSubmitting(true);
    setAuthError(null);
    setDomainError(false);
    try {
      const user = await signInWithGoogle();
      setCurrentUser(user);
    } catch (err: any) {
      console.warn('Google sign-in error:', err);
      const isDomainIssue =
        err.code === 'auth/invalid-continue-uri' ||
        err.message?.includes('invalid-continue-uri') ||
        err.code === 'auth/unauthorized-domain' ||
        err.message?.includes('unauthorized-domain') ||
        err.code === 'auth/unauthorized-continue-uri' ||
        err.message?.includes('unauthorized-continue-uri');

      if (isDomainIssue) {
        setDomainError(true);
        setAuthError(
          `Firebase rejected Google OAuth because this domain (${currentHost}) is not yet in the Firebase project Authorized Domains whitelist.`
        );
      } else if (err.code === 'auth/popup-blocked') {
        setAuthError('Google sign-in popup was blocked by your browser. Please allow popups.');
      } else {
        setAuthError(err.message || 'Google sign-in encountered an issue.');
      }
    } finally {
      setAuthSubmitting(false);
    }
  };

  // Email Sign-In / Sign-Up handler
  const handleEmailAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword) return;

    setAuthSubmitting(true);
    setAuthError(null);
    setDomainError(false);

    try {
      let user: User;
      if (authMode === 'signup') {
        user = await signUpWithEmail(authEmail, authPassword, authName);
      } else {
        user = await signInWithEmail(authEmail, authPassword);
      }
      setCurrentUser(user);
    } catch (err: any) {
      console.warn('Email auth error:', err);
      const isDomainIssue =
        err.code === 'auth/invalid-continue-uri' ||
        err.message?.includes('invalid-continue-uri') ||
        err.code === 'auth/unauthorized-domain' ||
        err.message?.includes('unauthorized-domain') ||
        err.code === 'auth/unauthorized-continue-uri' ||
        err.message?.includes('unauthorized-continue-uri');

      if (isDomainIssue) {
        setDomainError(true);
        setAuthError(
          `Domain "${currentHost}" is awaiting Firebase Authorized Domains whitelist. You can use 1-click Fast-Track below.`
        );
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        setAuthError('Account not found with these credentials. Please check details or create a new account.');
      } else if (err.code === 'auth/email-already-in-use') {
        setAuthError('This email is already registered. Please click "Sign In" or use 1-click Fast-Track.');
      } else if (err.code === 'auth/weak-password') {
        setAuthError('Password is too weak. Please use at least 6 characters.');
      } else {
        setAuthError(err.message || 'Authentication error.');
      }
    } finally {
      setAuthSubmitting(false);
    }
  };

  // Handle request pairing code
  const handleRequestPairingCode = async (e?: React.FormEvent | boolean, forceParam = false) => {
    let isForce = forceParam;
    if (typeof e === 'boolean') {
      isForce = e;
    } else if (e && 'preventDefault' in e) {
      e.preventDefault();
    }
    if (!phoneNumber) return;

    if (!currentUser) {
      setIsAuthModalOpen(true);
      return;
    }

    // Check License: NEVER should a user be connected to bot while license key is expired
    const isActuallyUnlimited = isOwner || (!userLicenseData.expiresAt && userLicenseData.isUnlimited);
    let effectiveExpiry = userLicenseData.expiresAt;
    if (!effectiveExpiry && currentUser?.uid) {
      try {
        const cached = localStorage.getItem(`solvatech_license_expiresAt_${currentUser.uid}`);
        if (cached && new Date(cached).getTime() > Date.now()) {
          effectiveExpiry = cached;
        }
      } catch {}
    }
    const licenseCheck = calculateRemainingTime(effectiveExpiry, isActuallyUnlimited, Date.now() + serverClockOffsetMs);
    if (!isActuallyUnlimited && licenseCheck.isExpired) {
      setActiveTab('license');
      setInTabError('🚨 Pairing Blocked: Your license key has expired! Users can NEVER connect to the WhatsApp bot while their license is expired. Please redeem a valid key or choose a plan below.');
      return;
    }

    let cleanEntered = phoneNumber.replace(/\D/g, '');
    if (cleanEntered.startsWith('00')) {
      cleanEntered = cleanEntered.substring(2);
    }

    const cleanDial = selectedCountry.dialCode.replace(/\D/g, '');
    
    // Auto-fix: if user typed/pasted number already starting with the selected country code
    if (cleanDial && cleanEntered.startsWith(cleanDial + cleanDial)) {
      cleanEntered = cleanEntered.substring(cleanDial.length * 2);
    } else if (cleanDial && cleanEntered.startsWith(cleanDial)) {
      cleanEntered = cleanEntered.substring(cleanDial.length);
    }
    // Remove domestic leading trunk zero (e.g., 080... -> 80...)
    while (cleanEntered.startsWith('0')) {
      cleanEntered = cleanEntered.substring(1);
    }

    const fullNumber = `${cleanDial}${cleanEntered}`;

    setLoading(true);
    setPairingError(null);

    try {
      const res = await fetch('/api/whatsapp/pair-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: fullNumber,
          userId: currentUser?.uid,
          userEmail: currentUser?.email,
          isExpired: licenseCheck.isExpired,
          isUnlimited: isOwner || userLicenseData.isUnlimited,
          licenseExpiresAt: effectiveExpiry || userLicenseData.expiresAt,
          force: isForce,
        }),
      });

      const data = await safeParseJson(res);
      if (res.ok && data && data.success) {
        setPairingCode(data.pairingCode);
        setStatus((prev) => ({
          ...prev,
          state: 'awaiting_pairing',
          pairingStage: 'code_generated',
          pairingCode: data.pairingCode,
          targetPhone: `+${fullNumber}`,
        }));
        setToastNotification({
          id: 'pairing_code_' + Date.now(),
          type: 'pairing',
          title: 'Pairing Code Generated 💬',
          body: `Code: ${data.pairingCode}. Enter this code in WhatsApp > Linked Devices > Link with phone number.`,
          timestamp: new Date().toLocaleTimeString(),
        });
        sendDeviceNotification(
          `WhatsApp Pairing Code: ${data.pairingCode}`,
          `Enter ${data.pairingCode} in WhatsApp > Linked Devices > Link with phone number to pair.`
        );
        setTimeout(() => setToastNotification(null), 8000);
      } else {
        setPairingError(
          data?.error ||
          data?.message ||
          (res.status === 503
            ? 'WhatsApp bot engine is connecting to servers, please retry in 5 seconds.'
            : `Failed to request pairing code (${res.status}). Please try again.`)
        );
      }
    } catch (err: any) {
      setPairingError(err.message || 'Error communicating with WhatsApp server');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (!pairingCode) return;
    navigator.clipboard.writeText(pairingCode.replace(/-/g, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRequestQrCode = async () => {
    if (!currentUser?.uid) return;
    setQrLoading(true);
    setPairingError(null);
    try {
      const res = await fetch('/api/whatsapp/qr-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.uid }),
      });
      const data = await safeParseJson(res);
      if (res.ok && data?.qrCodeUrl) {
        setStatus((prev) => ({
          ...prev,
          qrCodeUrl: data.qrCodeUrl,
          state: 'awaiting_pairing',
        }));
        setToastNotification({
          id: 'qr_' + Date.now(),
          type: 'system',
          title: '📷 QR Code Ready',
          body: 'Scan this code with WhatsApp > Linked Devices > Link a Device',
          timestamp: new Date().toLocaleTimeString(),
        });
        setTimeout(() => setToastNotification(null), 5000);
      } else {
        setPairingError(data?.error || 'Failed to generate QR code. You can use the 8-digit pairing code above.');
      }
    } catch (e: any) {
      setPairingError(e.message || 'Error generating QR code');
    } finally {
      setQrLoading(false);
    }
  };

  const handleLogoutWhatsApp = async () => {
    if (!confirm('Unlink this WhatsApp session?')) return;
    setLoading(true);
    try {
      await fetch('/api/whatsapp/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser?.uid }),
      });
      setPairingCode(null);
      setStatus({ state: 'disconnected', isConnected: false, pairingStage: 'idle' });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Redeem key with accurate time stacking
  const handleRedeemInTab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inTabKeyInput.trim() || inTabRedeeming) return;
    if (!currentUser?.uid || !currentUser.email) {
      setInTabError('Please sign in with your account before redeeming a license key.');
      return;
    }

    setInTabRedeeming(true);
    setInTabSuccess(null);
    setInTabError(null);

    try {
      const res = await redeemKey(
        currentUser.uid,
        currentUser.email,
        inTabKeyInput
      );

      if (res.success) {
        setInTabSuccess(res.message);
        setInTabKeyInput('');
        if (res.expiresAt) {
          try {
            localStorage.setItem(`solvatech_license_expiresAt_${currentUser.uid}`, res.expiresAt);
            if (currentUser.email) localStorage.setItem(`solvatech_license_expiresAt_${currentUser.email.toLowerCase()}`, res.expiresAt);
          } catch {}
        }
        setUserLicenseData((prev) => ({
          ...prev,
          expiresAt: res.expiresAt || prev.expiresAt,
          plan: 'Active Paid Plan',
          key: inTabKeyInput.trim().toUpperCase(),
          isUnlimited: false,
        }));
      } else {
        setInTabError(res.message);
      }
    } catch (err: any) {
      setInTabError(err.message || 'Error activating key');
    } finally {
      setInTabRedeeming(false);
    }
  };

  // 30-Minute Free Test (Once in a Lifetime) state and check
  useEffect(() => {
    if (!currentUser) {
      setHasClaimedTrial(false);
      return;
    }

    const check = () => {
      checkUserTrialStatus(currentUser.uid, currentUser.email).then((claimed) => {
        setHasClaimedTrial(claimed);
      });
    };

    check();
    window.addEventListener('focus', check);
    return () => {
      window.removeEventListener('focus', check);
    };
  }, [currentUser]);

  const handleClaim30MinTrial = async () => {
    if (!currentUser) {
      setIsAuthModalOpen(true);
      return;
    }
    setClaimingTrial(true);
    setTrialMessage(null);
    try {
      const res = await claim30MinuteTrial(
        currentUser.uid,
        currentUser.email || `${currentUser.uid}@solvatech.com`
      );
      if (res.success) {
        setHasClaimedTrial(true);
        const newExpiresAt = res.expiresAt || new Date(Date.now() + 30 * 60 * 1000).toISOString();
        try {
          localStorage.setItem(`solvatech_trial_claimed_${currentUser.uid}`, 'true');
          if (currentUser.email) localStorage.setItem(`solvatech_trial_claimed_${currentUser.email.toLowerCase()}`, 'true');
          localStorage.setItem(`solvatech_license_expiresAt_${currentUser.uid}`, newExpiresAt);
          if (currentUser.email) localStorage.setItem(`solvatech_license_expiresAt_${currentUser.email.toLowerCase()}`, newExpiresAt);
        } catch {}
        setTrialMessage({ type: 'success', text: res.message });
        setUserLicenseData({
          expiresAt: newExpiresAt,
          plan: '⚡ 30-Minute Free Trial (Active)',
          key: null,
          isUnlimited: false,
        });
        setToastNotification({
          id: 'trial_' + Date.now(),
          type: 'system',
          title: '🎉 30-Minute Free Test Activated!',
          body: 'Countdown has begun instantly! Link your WhatsApp below to test all bot features.',
          timestamp: new Date().toLocaleTimeString(),
        });
        setTimeout(() => setToastNotification(null), 5000);
      } else {
        setTrialMessage({ type: 'error', text: res.message });
        if (res.message.includes('already been used') || res.message.includes('already been claimed')) {
          setHasClaimedTrial(true);
        }
      }
    } catch (err: any) {
      setTrialMessage({ type: 'error', text: err.message || 'Error claiming 30-minute trial' });
    } finally {
      setClaimingTrial(false);
    }
  };

  const isLicenseActive =
    isOwner ||
    userLicenseData.isUnlimited ||
    !calculateRemainingTime(userLicenseData.expiresAt, false, Date.now() + serverClockOffsetMs).isExpired;

  // Reconnect to existing companion WhatsApp session (tries for 1 minute, drops exact reason)
  const handleUserReconnect = async () => {
    if (!currentUser?.uid) {
      setIsAuthModalOpen(true);
      return;
    }

    if (!isLicenseActive) {
      setReconnectFeedback({
        type: 'error',
        message: 'Cannot reconnect: Your license duration has elapsed. Please enter a valid license key or activate a test first.',
        reason: 'no_license',
      });
      return;
    }

    setIsReconnecting(true);
    setReconnectFeedback(null);
    setReconnectSecondsLeft(60);

    const timer = setInterval(() => {
      setReconnectSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    try {
      const res = await fetch('/api/whatsapp/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.uid,
          userEmail: currentUser.email,
        }),
      });
      clearInterval(timer);
      const data = await safeParseJson(res);

      if (res.ok && data?.success) {
        setReconnectFeedback({
          type: 'success',
          message: data.message || '🎉 Successfully reconnected to your WhatsApp account! Bot is active 24/7.',
        });
        if (data.status) {
          setStatus(data.status);
        }
        setToastNotification({
          id: 'reconnected_' + Date.now(),
          type: 'connection',
          title: 'WhatsApp Reconnected! 🟢',
          body: data.message || 'Your WhatsApp account is active and listening for commands 24/7.',
          timestamp: new Date().toLocaleTimeString(),
        });
      } else {
        const reason = data?.reason;
        let msg = data?.error || 'Failed to reconnect.';
        if (reason === 'no_record') {
          msg = "No record of WhatsApp linked before for this account. Tap 'Pair WhatsApp' below to link your phone number first.";
        } else if (reason === 'unlinked') {
          msg = "This device was unlinked from WhatsApp on your phone. Tap 'Pair WhatsApp' below to link fresh with a new pairing code.";
        } else if (reason === 'no_license') {
          msg = "Cannot reconnect: License is expired. Please enter a license key to activate your account.";
        } else if (reason === 'unreachable' || res?.status === 504) {
          msg = "Could not reach WhatsApp on your phone within 1 minute. Ensure your phone has internet and WhatsApp open, or tap 'Pair WhatsApp' instead.";
        }
        setReconnectFeedback({
          type: 'error',
          message: msg,
          reason,
        });
      }
    } catch (err: any) {
      clearInterval(timer);
      setReconnectFeedback({
        type: 'error',
        message: err?.message || "Could not communicate with WhatsApp server. Tap 'Pair WhatsApp' instead.",
      });
    } finally {
      setIsReconnecting(false);
      setReconnectSecondsLeft(0);
    }
  };

  // 3-Step Live Confirmation Flags
  const isStep1Active =
    !!pairingCode ||
    status.pairingStage === 'code_generated' ||
    status.pairingStage === 'pairing_handshake' ||
    status.isConnected;

  const isStep2Active =
    status.pairingStage === 'pairing_handshake' ||
    status.pairingStage === 'connected' ||
    status.isConnected ||
    status.state === 'connected';

  const isStep3Active =
    status.isConnected ||
    status.state === 'connected' ||
    status.pairingStage === 'connected';

  // Compact bot commands list
  const BOT_COMMANDS = [
    { cmd: '.menu', desc: 'Display all bot commands & active bot info' },
    { cmd: '.ping', desc: 'Check network speed and response latency' },
    { cmd: '.uptime', desc: 'Show how long your account has been linked' },
    { cmd: '.owner', desc: 'Developer & Solomon contact details' },
    { cmd: '.expire', desc: 'Check your license expiry & remaining days/minutes' },
    { cmd: '.plans / .buy', desc: 'Official license duration plans & OPay pricing' },
    { cmd: '.signature', desc: 'Official verified developer signature & credentials' },
    { cmd: '.sticker', desc: 'Convert image or video to WhatsApp sticker' },
    { cmd: '.antisticker', desc: 'Convert sticker back into photo or video' },
    { cmd: '.read', desc: 'Extract text from photo via OCR' },
    { cmd: '.open', desc: 'View-once media receiver (anti-view-once)' },
    { cmd: '.tagall <msg>', desc: 'Mention all group members at once' },
    { cmd: '.pin', desc: 'Pin message in WhatsApp group for 7 days' },
    { cmd: '.del', desc: 'Delete replied message from group' },
    { cmd: '.kick @user', desc: 'Remove member from WhatsApp group' },
    { cmd: '.add <number>', desc: 'Add participant to group with country code' },
    { cmd: '.promote @user', desc: 'Promote participant to group admin' },
    { cmd: '.demote @user', desc: 'Demote group admin to normal member' },
    { cmd: '.lock / .unlock', desc: 'Close or open group chat for members' },
    { cmd: '.autowelcome on/off', desc: 'Auto-greet joining members with user tags & group description' },
    { cmd: '.autogoodbye on/off', desc: 'Auto-farewell departing or removed members with remaining count' },
    { cmd: '.anti', desc: 'Display full group security matrix & current active shields' },
    { cmd: '.antilink on/off', desc: 'Automatically remove external group links' },
    { cmd: '.antibot on/off', desc: 'Auto-kick unauthorized bot accounts' },
    { cmd: '.antistatus on/off', desc: 'Auto-remove WhatsApp status group mentions' },
    { cmd: '.antispam on/off', desc: 'Purge spam messages & instant kick on continuous spam' },
    { cmd: '.warn @user', desc: 'Issue warning to group participant' },
  ];

  const filteredCommands = BOT_COMMANDS.filter(
    (c) =>
      c.cmd.toLowerCase().includes(commandSearch.toLowerCase()) ||
      c.desc.toLowerCase().includes(commandSearch.toLowerCase())
  );

  // Loading / Splash Screen
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 text-center max-w-xs">
          <div className="relative">
            <div className="absolute -inset-2 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-3xl blur-xl opacity-40" />
            <img
              src="/solva.webp"
              alt="SOLVATECH BOT"
              className="relative w-24 h-24 rounded-2xl object-cover ring-2 ring-emerald-500/50 shadow-2xl shadow-emerald-500/30"
            />
          </div>
          <div>
            <h1 className="text-base font-extrabold text-white tracking-wide">SOLVATECH BOT</h1>
            <p className="text-[11px] text-slate-400 mt-0.5">24/7 Multi-Device Automation Engine</p>
          </div>
          <p className="text-xs font-mono text-emerald-400 flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Initializing System...
          </p>
        </div>
      </div>
    );
  }

  // FIRST SCREEN: Google Sign-in / Sign-up Gateway (Shown first when user is not logged in)
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-0 sm:p-4 font-sans">
        <div className="w-full sm:max-w-md bg-slate-900 sm:border border-slate-800 sm:rounded-[36px] rounded-none shadow-2xl flex flex-col h-screen sm:h-[840px] max-h-screen sm:max-h-[840px] overflow-hidden relative">
          {/* Mandatory Persistent Allow Notification Banner */}
          <NotificationBanner />

          {/* Header */}
          <div className="p-6 text-center border-b border-slate-800 bg-gradient-to-b from-slate-950 to-slate-900 shrink-0">
            <div className="relative inline-block mb-3">
              <div className="absolute -inset-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-2xl blur opacity-40" />
              <img
                src="/solva.webp"
                alt="SOLVATECH BOT"
                className="relative w-16 h-16 rounded-2xl object-cover ring-2 ring-emerald-500/50 shadow-lg shadow-emerald-950/60"
              />
            </div>
            <h1 className="text-xl font-extrabold text-white tracking-tight">SOLVATECH BOT</h1>
            <p className="text-xs text-slate-400 mt-1">
              WhatsApp Multi-Device Engine • 35+ Commands & 24/7 Security
            </p>
          </div>

          {/* Form Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="text-center">
                <h2 className="text-sm font-bold text-white">Sign In to Continue</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Sign in with your Google account to connect WhatsApp and access your bot.
                </p>
              </div>

              {/* FIRST THING: Sign in with Google */}
              <button
                type="button"
                onClick={handleGoogleSignInFirst}
                disabled={authSubmitting}
                className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs shadow-lg transition-all active:scale-[0.98] disabled:opacity-50"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>{authSubmitting ? 'Signing in with Google...' : 'Continue with Google'}</span>
              </button>

              <div className="relative flex items-center justify-center py-1">
                <div className="border-t border-slate-800 w-full"></div>
                <span className="bg-slate-950 px-3 text-[10px] text-slate-500 uppercase tracking-wider absolute">
                  or use email
                </span>
              </div>

              {/* Email Form Toggle */}
              <div className="flex rounded-xl bg-slate-900 p-1 border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => { setAuthMode('signup'); setAuthError(null); }}
                  className={`flex-1 py-1.5 rounded-lg font-bold transition-all ${
                    authMode === 'signup' ? 'bg-emerald-600 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Create Account
                </button>
                <button
                  type="button"
                  onClick={() => { setAuthMode('login'); setAuthError(null); }}
                  className={`flex-1 py-1.5 rounded-lg font-bold transition-all ${
                    authMode === 'login' ? 'bg-emerald-600 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Sign In
                </button>
              </div>

              {/* Email Form */}
              <form onSubmit={handleEmailAuthSubmit} className="space-y-2.5 text-xs">
                {authMode === 'signup' && (
                  <div>
                    <label className="block text-slate-400 mb-1 text-[11px]">Full Name</label>
                    <div className="relative">
                      <UserIcon className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        value={authName}
                        onChange={(e) => setAuthName(e.target.value)}
                        placeholder="Your Name"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-xs"
                        required
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-slate-400 mb-1 text-[11px]">Email Address</label>
                  <div className="relative">
                    <Mail className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-xs"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 text-[11px]">Password</label>
                  <div className="relative">
                    <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-xs"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={authSubmitting}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 text-slate-950 font-bold text-xs shadow-md transition-all disabled:opacity-50 mt-1"
                >
                  {authSubmitting
                    ? 'Processing...'
                    : authMode === 'signup'
                    ? 'Create SOLVATECH Account'
                    : 'Sign In'}
                </button>
              </form>

              {/* Domain Authorization Notice (Shown if Firebase rejects domain with auth/invalid-continue-uri or auth/unauthorized-domain) */}
              {domainError && (
                <div className="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-500/50 space-y-2.5 animate-in fade-in duration-200">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-200 space-y-1">
                      <p className="font-bold text-amber-300">Firebase Authorized Domain Notice</p>
                      <p className="text-[11px] text-amber-300/80 leading-relaxed">
                        Firebase rejected OAuth because this domain is not yet in your Firebase project's <strong>Authorized domains</strong> list.
                      </p>
                    </div>
                  </div>

                  {/* Whitelist helper & copy domain */}
                  <div className="p-2 bg-slate-900 rounded-xl border border-amber-500/30 flex items-center justify-between text-xs font-mono">
                    <span className="text-amber-200 truncate pr-2 text-[11px]">{currentHost}</span>
                    <button
                      type="button"
                      onClick={copyDomain}
                      className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[10px] font-sans font-bold border border-amber-500/40 cursor-pointer"
                    >
                      {copiedDomain ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedDomain ? 'Copied' : 'Copy Domain'}</span>
                    </button>
                  </div>

                  <div className="text-[10px] text-slate-400 space-y-0.5">
                    <p className="text-slate-300 font-semibold">How to whitelist in Firebase Console:</p>
                    <p>1. Open Firebase Console &gt; Authentication &gt; Settings &gt; Authorized domains</p>
                    <p>2. Click "Add domain" and paste your copied domain</p>
                  </div>

                  <div className="pt-2 border-t border-amber-500/20 text-center">
                    <p className="text-[11px] text-amber-300/90 font-medium mb-2">
                      You can create an account or sign in with Email & Password directly in Firebase!
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode('signup');
                        setDomainError(false);
                      }}
                      className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 text-slate-950 font-bold text-xs shadow flex items-center justify-center gap-2 cursor-pointer transition-all"
                    >
                      <UserIcon className="w-3.5 h-3.5 text-slate-950" />
                      <span>Create Account with Email & Password</span>
                    </button>
                  </div>
                </div>
              )}

              {authError && !domainError && (
                <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                  <span>{authError}</span>
                </div>
              )}
            </div>

            {/* Feature Highlights */}
            <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-400 space-y-2">
              <p className="font-semibold text-white">⚡ Features included:</p>
              <ul className="space-y-1 list-disc list-inside text-slate-400">
                <li>Real-time Baileys Multi-Device WhatsApp connection</li>
                <li>Anti-Delete & View-Once personal DM message recovery</li>
                <li>35+ Automated Group Security & Admin commands</li>
                <li>Gemini AI Assistant (.ai) & Image OCR Text Extraction</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // AUTHENTICATED DASHBOARD VIEW
  return (
    <div className="h-[100dvh] max-h-[100dvh] w-full bg-slate-950 text-slate-100 flex justify-center p-0 sm:py-2 font-sans select-none sm:select-auto overflow-hidden">
      {/* Toast Notification Banner */}
      {toastNotification && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-sm w-full px-4 animate-in slide-in-from-top duration-200">
          <div className="p-3 rounded-2xl bg-slate-900 border border-emerald-500/50 shadow-2xl flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <Bell className="w-3.5 h-3.5" />
              </div>
              <div className="truncate">
                <p className="font-bold text-white text-[11px] truncate">{toastNotification.title}</p>
                <p className="text-[10px] text-slate-400 truncate">{toastNotification.body}</p>
              </div>
            </div>
            <button
              onClick={() => setToastNotification(null)}
              className="text-slate-500 hover:text-white p-1 text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main Container Phone Frame */}
      <div className="w-full max-w-lg mx-auto bg-slate-900 border-x sm:border border-slate-800 sm:rounded-3xl shadow-2xl flex flex-col h-full sm:h-[96vh] sm:max-h-[920px] relative overflow-hidden">
        {/* Mandatory Persistent Allow Notification Banner */}
        <NotificationBanner onPermissionGranted={() => {
          setToastNotification({
            id: 'notif_granted_' + Date.now(),
            type: 'system',
            title: 'Notifications Allowed 🔔',
            body: 'You will receive instant alerts for license extensions and 30m/15m/5m expiry warnings.',
            timestamp: new Date().toLocaleTimeString(),
          });
        }} />

        {/* Top Header */}
        <header className="shrink-0 z-40 px-3.5 pt-3 pb-2.5 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/90 flex flex-col gap-2 shadow-md">
          <div className="flex items-center justify-between gap-1 sm:gap-2">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <img
                src="/solva.webp"
                alt="SOLVATECH"
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl object-cover ring-1 ring-emerald-500/40 shadow-md shadow-emerald-950/60 shrink-0"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <h1 className="font-extrabold text-xs sm:text-sm text-white tracking-tight truncate">SOLVATECH</h1>
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      status.isConnected
                        ? 'bg-emerald-400'
                        : status.pairingStage === 'pairing_handshake'
                        ? 'bg-amber-400'
                        : status.isPaired && status.state === 'connecting'
                        ? 'bg-amber-400'
                        : 'bg-rose-500'
                    }`}
                  />
                </div>
                <p className="text-[9px] sm:text-[10px] text-slate-400 font-mono truncate">
                  {status.isConnected
                    ? 'WhatsApp Linked'
                    : status.isPaired && status.state === 'connecting'
                    ? 'Reconnecting in background'
                    : status.isPaired
                    ? 'WhatsApp Linked · Paused'
                    : status.pairingStage === 'pairing_handshake'
                    ? 'Handshake Confirmed'
                    : 'Baileys Multi-Device'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              {/* PWA Install Button (Compact header mode) */}
              <PWAInstallButton variant="button" />

              {/* Force Immediate Refresh WhatsApp Status Button */}
              <button
                type="button"
                onClick={handleRefreshStatus}
                disabled={isRefreshingStatus}
                className="p-1 sm:p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-emerald-400 border border-slate-700/80 transition-colors cursor-pointer"
                title="Refresh WhatsApp Status Immediately"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingStatus ? 'animate-spin text-emerald-400' : ''}`} />
              </button>

              {/* WhatsApp Live Notifications Button */}
              <button
                onClick={() => setIsNotificationsOpen(true)}
                className="relative p-1 sm:p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-emerald-400 border border-slate-700/80 transition-colors cursor-pointer"
                title="Open WhatsApp Notifications Stream"
              >
                <Bell className="w-3.5 h-3.5" />
                {notifications.length > 0 && (
                  <span className="absolute -top-1 -right-1 px-1 rounded-full bg-emerald-500 text-slate-950 font-bold text-[8px] min-w-3 text-center">
                    {notifications.length}
                  </span>
                )}
              </button>

              {/* Owner Admin Hub Button - strictly for owner */}
              {isOwner && (
                <button
                  onClick={() => setIsAdminModalOpen(true)}
                  className="px-2 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer"
                  title="Open Admin Dashboard Application"
                >
                  <Zap className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />
                  <span className="hidden xs:inline">Admin</span>
                </button>
              )}

              {/* User Account / Google Sign-in */}
              <UserAccountNav
                user={currentUser}
                onOpenAuthModal={() => setIsAuthModalOpen(true)}
              />
            </div>
          </div>

          {/* Real-time License Countdown Banner */}
          <button
            onClick={() => setActiveTab('license')}
            className={`w-full px-2.5 py-1.5 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
              isLicenseActive
                ? 'bg-emerald-950/30 border-emerald-500/40 hover:bg-emerald-950/40'
                : 'bg-rose-950/30 border-rose-500/40 hover:bg-rose-950/40'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Clock
                className={`w-3.5 h-3.5 shrink-0 ${
                  isLicenseActive ? 'text-emerald-400' : 'text-rose-400'
                }`}
              />
              <div className="truncate">
                <span className="text-[9px] text-slate-400 block leading-tight">License Time:</span>
                <LicenseCountdown
                  expiresAt={userLicenseData.expiresAt}
                  isUnlimited={isOwner || userLicenseData.isUnlimited}
                  nowOffsetMs={serverClockOffsetMs}
                />
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 text-[10px] font-bold text-slate-300 bg-slate-900/90 px-2 py-0.5 rounded-md border border-slate-700/60">
              <span>{isOwner || userLicenseData.isUnlimited ? '👑 VIP' : 'Stack / Add'}</span>
              <Zap className="w-2.5 h-2.5 text-amber-400" />
            </div>
          </button>
        </header>

        {/* Content Body - Scrollable independently while header and footer stay pinned */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 overscroll-contain">
          {/* Universal PWA App Install Banner for Phone, Android, Chrome & iOS */}
          <PWAInstallButton variant="banner" />

          {/* 2 MANDATORY LINKS STRICTLY FORCED FOR EVERY USER */}
          <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-950/70 via-slate-900 to-amber-950/50 border border-emerald-500/40 space-y-2.5 shadow-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-xs font-black text-white tracking-wide">
                  OFFICIAL CHANNELS (MANDATORY)
                </span>
              </div>
              <span className="text-[9px] font-bold text-emerald-300 bg-emerald-950 px-2 py-0.5 rounded-full border border-emerald-500/30">
                Strictly Required ✓
              </span>
            </div>

            <p className="text-[11px] text-slate-300 leading-tight">
              All users must follow our official updates channel and join the community group:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <a
                href="https://whatsapp.com/channel/0029Vb86yuY7j6gCHqMqcU37"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2.5 rounded-xl bg-emerald-950/90 hover:bg-emerald-900 border border-emerald-500/50 text-emerald-200 font-bold text-[11px] flex items-center justify-between transition-all group"
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="text-sm">🔊</span>
                  <div className="truncate text-left">
                    <span className="block font-bold truncate">SOLVATECH • UPDATES</span>
                    <span className="text-[9px] text-emerald-400/80 font-normal">WhatsApp Channel</span>
                  </div>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-emerald-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
              </a>

              <a
                href="https://chat.whatsapp.com/HKBAnW6XJmB9fBqSPJUN1F?s=cl&p=a&mlu=4&ilr=4"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2.5 rounded-xl bg-amber-950/70 hover:bg-amber-900 border border-amber-500/50 text-amber-200 font-bold text-[11px] flex items-center justify-between transition-all group"
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="text-sm">👥</span>
                  <div className="truncate text-left">
                    <span className="block font-bold truncate">Community Group</span>
                    <span className="text-[9px] text-amber-300/80 font-normal">WhatsApp Community</span>
                  </div>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-amber-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
              </a>
            </div>
          </div>

          {/* TAB 1: PAIR WHATSAPP */}
          {activeTab === 'pair' && (
            <div className="space-y-4">
              {/* WhatsApp Connection Status Banner if Connected */}
              {status.isConnected && (
                <div className="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-500/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-white">Bot Connected & Active</h3>
                        <p className="text-[11px] text-emerald-300/80 font-mono">
                          {status.user?.phone || status.targetPhone || 'Active Device'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleLogoutWhatsApp}
                      disabled={loading}
                      className="p-2 rounded-xl bg-slate-900 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-800 transition-colors"
                      title="Unlink WhatsApp"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    Your bot is listening to messages and answering commands (.menu, .ping, etc.) in your WhatsApp.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('groups')}
                    className="w-full mt-2 py-2 px-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 transition-all cursor-pointer"
                  >
                    <Crown className="w-4 h-4" />
                    <span>Open Group Admin & Welcome Controls →</span>
                  </button>
                </div>
              )}

              {/* WhatsApp Reconnecting Card (e.g. after Railway restart) */}
              {!status.isConnected && status.isPaired && !status.pairingCode && status.pairingStage !== 'code_generated' && status.state === 'connecting' && (
                <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900 to-teal-950/30 border border-emerald-500/50 space-y-3 shadow-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40">
                        <RefreshCw className="w-5 h-5 text-emerald-400 animate-spin" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm text-white">Reconnecting to WhatsApp...</h3>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9px] font-bold uppercase tracking-wider animate-pulse">
                            24/7 AUTO-CONNECTING
                          </span>
                        </div>
                        <p className="text-[11px] text-emerald-300 font-mono">
                          {status.user?.phone || status.targetPhone || 'Locked Paired Phone'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleLogoutWhatsApp}
                      disabled={loading}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-800 text-[11px] font-bold transition-colors flex items-center gap-1.5"
                      title="Unlink and pair a new number immediately"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Unlink / Change Number</span>
                    </button>
                  </div>

                  {/* Manual Reconnect Action Trigger */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleUserReconnect}
                      disabled={isReconnecting || loading}
                      className="w-full py-2 px-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin' : ''}`} />
                      <span>{isReconnecting ? `Trying Reconnect (${reconnectSecondsLeft}s)...` : '⚡ Reconnect Now (1-Min Try)'}</span>
                    </button>
                  </div>

                  {/* Background Reconnection Cloud Assurance */}
                  <div className="p-2.5 rounded-xl bg-slate-950/60 border border-emerald-500/30 space-y-1">
                    <div className="flex items-center gap-2 text-xs text-emerald-300 font-medium">
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Persistent Cloud Lock Active</span>
                    </div>
                    <p className="text-[10px] text-slate-300 leading-relaxed">
                      Your phone number is locked in cloud storage. Even if Railway restarts, crashes, or is redeployed, your session keys are safely backed up. The Railway 1-minute heartbeat automatically restores your keys and reconnects your bot in the background so you can execute commands 24/7.
                    </p>
                  </div>
                </div>
              )}

              {/* WhatsApp Paired Device Banner when Paused (License Expired or Paused) */}
              {!status.isConnected && status.isPaired && !status.pairingCode && status.pairingStage !== 'code_generated' && status.state !== 'connecting' && (
                <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                        <Smartphone className="w-5 h-5 text-amber-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm text-white">WhatsApp Linked for Life</h3>
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-bold uppercase tracking-wider">
                            {status.state === 'expired' || !isLicenseActive
                              ? 'PAUSED (EXPIRED)'
                              : 'PAUSED'}
                          </span>
                        </div>
                        <p className="text-[11px] text-amber-300/80 font-mono">
                          {status.user?.phone || status.targetPhone || 'Paired Device'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleLogoutWhatsApp}
                      disabled={loading}
                      className="p-2 rounded-xl bg-slate-900 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-800 transition-colors"
                      title="Unlink WhatsApp"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    {status.state === 'expired' || !isLicenseActive
                      ? 'Your WhatsApp companion device is linked. 24/7 automation is currently paused because your active license duration has elapsed. Redeem a license key below to resume immediately.'
                      : 'Your device is linked but the bot is paused. Resume the connection from this page when you are ready.'}
                  </p>
                  {isLicenseActive && status.state !== 'expired' && (
                    <button
                      type="button"
                      onClick={handleUserReconnect}
                      disabled={isReconnecting || loading}
                      className="w-full mt-2 py-2 px-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin' : ''}`} />
                      <span>{isReconnecting ? `Trying Reconnect (${reconnectSecondsLeft}s)...` : '⚡ Reconnect WhatsApp (1-Min Try)'}</span>
                    </button>
                  )}
                  {(!isLicenseActive || status.state === 'expired') && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('license')}
                      className="w-full mt-2 py-2 px-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-emerald-400 hover:from-amber-400 hover:to-emerald-300 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40 transition-all cursor-pointer"
                    >
                      <Key className="w-4 h-4" />
                      <span>Enter License Key to Resume Bot 24/7 →</span>
                    </button>
                  )}
                </div>
              )}

              {/* USER DASHBOARD FEATURE: ANTI-DELETE MESSAGE RECOVERY SWITCH */}
              <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 hover:border-slate-700/80 transition-all shadow-xl space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div
                      className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border transition-all ${
                        antiDeleteEnabled
                          ? 'bg-rose-500/10 border-rose-500/40 text-rose-400 shadow-md shadow-rose-950/40'
                          : 'bg-slate-800 border-slate-700 text-slate-500'
                      }`}
                    >
                      <Trash2 className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-sm text-white">Anti-Delete Message Recovery</h4>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            antiDeleteEnabled
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {antiDeleteEnabled ? 'ACTIVE (FLOOD TO DM) 🚨' : 'DISABLED (OFF) ⚪'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                        {antiDeleteEnabled ? (
                          <span className="text-rose-200/90">
                            ⚡ <strong>Active:</strong> All deleted messages from anywhere (groups & private chats) will instantly flood directly into your personal WhatsApp DM chat.
                          </span>
                        ) : (
                          <span className="text-slate-400">
                            ⚪ <strong>Inactive:</strong> Anti-delete recovery is turned off. Deleted messages are ignored and nothing is forwarded.
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* UI Toggle Switch */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={antiDeleteEnabled}
                    onClick={handleToggleAntiDelete}
                    disabled={togglingAntiDelete}
                    className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden disabled:opacity-50 ${
                      antiDeleteEnabled ? 'bg-rose-500 shadow-lg shadow-rose-500/30' : 'bg-slate-700'
                    }`}
                    title="Toggle Anti-Delete Message Recovery to Personal WhatsApp DM"
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                        antiDeleteEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* THREE LIVE STEP CONFIRMATION FLOW (ONLY SHOWN DURING ACTIVE PAIRING; LOCKED OUT WHEN CONNECTED) */}
              {!status.isConnected && (pairingCode || status.pairingStage === 'code_generated' || status.pairingStage === 'pairing_handshake') && (
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-emerald-400" />
                      <h3 className="font-bold text-xs text-white uppercase tracking-wider">
                        3-Step Live Link Confirmation
                      </h3>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-500/30">
                      {status.pairingStage === 'pairing_handshake'
                        ? 'Handshake'
                        : 'Code Ready'}
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {/* STEP 1: Code Generated */}
                    <div
                      className={`p-3 rounded-xl border transition-all ${
                        isStep1Active
                          ? 'bg-emerald-950/20 border-emerald-500/50 shadow-xs'
                          : 'bg-slate-900/60 border-slate-800 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${
                              isStep1Active
                                ? 'bg-emerald-500 text-slate-950'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {isStep1Active ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : '1'}
                          </div>
                          <div>
                            <h4 className="font-bold text-xs text-white">Step 1: Code Generated</h4>
                            <p className="text-[10px] text-slate-400">
                              {isStep1Active
                                ? 'Real Baileys code ready for WhatsApp'
                                : 'Generate pairing code below'}
                            </p>
                          </div>
                        </div>
                        {pairingCode && (
                          <span className="text-[10px] font-mono text-slate-400">
                            <PairingCountdown pairingCode={pairingCode} />
                          </span>
                        )}
                      </div>

                      {pairingCode && (
                        <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 bg-slate-950/80 px-3 py-2 rounded-lg">
                          <span className="font-mono text-xl font-extrabold tracking-widest text-emerald-400 select-all">
                            {pairingCode}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleRequestPairingCode(true)}
                              disabled={loading}
                              title="Generate a brand new fresh code if this one didn't work"
                              className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors flex items-center gap-1 text-[11px] font-bold"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                              <span>{loading ? 'Generating...' : 'New Code'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleCopyCode}
                              className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors flex items-center gap-1 text-[11px] font-bold"
                            >
                              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                              <span>{copied ? 'Copied' : 'Copy'}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* STEP 2: Pairing (Handshake) */}
                    <div
                      className={`p-3 rounded-xl border transition-all ${
                        isStep2Active
                          ? 'bg-emerald-950/25 border-emerald-500/60 shadow-xs'
                          : status.pairingStage === 'code_generated'
                          ? 'bg-amber-950/15 border-amber-500/40'
                          : 'bg-slate-900/60 border-slate-800 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${
                              isStep2Active
                                ? 'bg-emerald-500 text-slate-950'
                                : status.pairingStage === 'code_generated'
                                ? 'bg-amber-500 text-slate-950'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {isStep2Active ? (
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                            ) : status.pairingStage === 'code_generated' ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              '2'
                            )}
                          </div>
                          <div>
                            <h4 className="font-bold text-xs text-white">Step 2: Pairing (Handshake)</h4>
                            <p className="text-[10px] text-slate-400">
                              {isStep2Active
                                ? `Handshake received from WhatsApp phone! ${
                                    status.latestHandshakeTime ? `(${status.latestHandshakeTime})` : ''
                                  }`
                                : status.pairingStage === 'code_generated'
                                ? 'Waiting for you to enter code on WhatsApp phone...'
                                : 'Awaiting phone input & companion handshake'}
                            </p>
                          </div>
                        </div>
                        {isStep2Active && (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/30">
                            Handshake Confirmed ✓
                          </span>
                        )}
                      </div>
                    </div>

                    {/* STEP 3: Connected */}
                    <div
                      className={`p-3 rounded-xl border transition-all ${
                        isStep3Active
                          ? 'bg-emerald-950/30 border-emerald-400/80 shadow-md'
                          : 'bg-slate-900/60 border-slate-800 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${
                              isStep3Active ? 'bg-emerald-400 text-slate-950' : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {isStep3Active ? <CheckCircle2 className="w-3.5 h-3.5 stroke-[3]" /> : '3'}
                          </div>
                          <div>
                            <h4 className="font-bold text-xs text-white">Step 3: Connected</h4>
                            <p className="text-[10px] text-slate-400">
                              {isStep3Active
                                ? `Linked with ${status.user?.phone || status.targetPhone || 'Device'}. Bot active!`
                                : 'Awaiting final connection status'}
                            </p>
                          </div>
                        </div>
                        {isStep3Active && (
                          <span className="text-[10px] font-bold text-emerald-300 bg-emerald-950/90 px-2 py-0.5 rounded border border-emerald-400/40">
                            Live 🟢
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Pairing Request Form (only shown if not yet paired with any device) */}
              {!status.isConnected && !status.isPaired && !status.user?.phone && (
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-emerald-400" />
                      <h3 className="font-bold text-sm text-white">Link Your WhatsApp</h3>
                    </div>
                    <button
                      type="button"
                      onClick={handleRefreshStatus}
                      disabled={isRefreshingStatus}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900 hover:bg-slate-850 text-emerald-400 border border-slate-800 text-[11px] font-bold transition-all active:scale-95 shadow-xs"
                      title="Force immediate fetch of WhatsApp status from backend"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingStatus ? 'animate-spin' : ''}`} />
                      <span>{isRefreshingStatus ? 'Refreshing...' : 'Refresh Status'}</span>
                    </button>
                  </div>

                  {/* Reconnect Feedback Banner (with detailed dropped reason) */}
                  {reconnectFeedback && (
                    <div
                      className={`p-3.5 rounded-2xl text-xs space-y-2 border transition-all ${
                        reconnectFeedback.type === 'success'
                          ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                          : 'bg-rose-950/40 border-rose-500/50 text-rose-300'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        {reconnectFeedback.type === 'success' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        )}
                        <div className="space-y-1.5 min-w-0">
                          <p className="font-semibold leading-relaxed">{reconnectFeedback.message}</p>
                          {reconnectFeedback.reason === 'no_license' && (
                            <button
                              type="button"
                              onClick={() => {
                                setReconnectFeedback(null);
                                setActiveTab('license');
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-500 text-slate-950 font-bold text-[11px] shadow-sm cursor-pointer"
                            >
                              <Key className="w-3.5 h-3.5" />
                              <span>Go to License Tab to Enter Key →</span>
                            </button>
                          )}
                          {(reconnectFeedback.reason === 'unlinked' ||
                            reconnectFeedback.reason === 'no_record' ||
                            reconnectFeedback.reason === 'unreachable') && (
                            <button
                              type="button"
                              onClick={() => setReconnectFeedback(null)}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-[11px] border border-slate-700 cursor-pointer"
                            >
                              <span>Tap Pair with Phone Number Below ↓</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Fast-Track Reconnect to Old WhatsApp card */}
                  <div className="p-3 rounded-2xl bg-gradient-to-r from-emerald-950/30 via-slate-900 to-teal-950/20 border border-emerald-500/30 flex items-center justify-between gap-3 flex-wrap">
                    <div className="space-y-0.5 min-w-0">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Already Linked Before?</span>
                      </span>
                      <p className="text-[10px] text-slate-400">
                        Try reconnecting for 1 min to your old WhatsApp session without a new code.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleUserReconnect}
                      disabled={isReconnecting || loading}
                      className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 text-xs font-black flex items-center gap-1.5 transition-all active:scale-95 shadow-md shadow-emerald-950/40 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin' : ''}`} />
                      <span>{isReconnecting ? `Trying Reconnect (${reconnectSecondsLeft}s)...` : '⚡ Reconnect WhatsApp'}</span>
                    </button>
                  </div>

                  {!isLicenseActive && !hasClaimedTrial && (
                    <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/70 via-slate-900 to-emerald-950/50 border-2 border-amber-500/60 shadow-xl space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <img
                            src="/solva.webp"
                            alt="SOLVATECH"
                            className="w-10 h-10 rounded-xl object-cover ring-1 ring-amber-500/50 shadow-md shrink-0"
                          />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-bold text-sm text-white">🎁 30-Minute Free Test</h4>
                              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold uppercase tracking-wider">
                                Once in a Lifetime
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                              New account bonus: Get <strong>30 minutes of free, unrestricted access</strong> to connect your WhatsApp and test all commands, Anti-Delete, and group defense!
                            </p>
                          </div>
                        </div>
                      </div>

                      {trialMessage && (
                        <div
                          className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                            trialMessage.type === 'success'
                              ? 'bg-emerald-950/50 border border-emerald-500/50 text-emerald-300'
                              : 'bg-rose-950/50 border border-rose-500/50 text-rose-300'
                          }`}
                        >
                          {trialMessage.type === 'success' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                          )}
                          <span>{trialMessage.text}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                        <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>Status: Ready to Claim (No payment needed)</span>
                        </div>

                        <button
                          type="button"
                          onClick={handleClaim30MinTrial}
                          disabled={claimingTrial}
                          className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-emerald-400 hover:from-amber-400 hover:to-emerald-300 text-slate-950 font-black text-xs shadow-lg shadow-amber-950/40 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95"
                        >
                          {claimingTrial ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Activating...</span>
                            </>
                          ) : (
                            <>
                              <Zap className="w-3.5 h-3.5 fill-slate-950" />
                              <span>{currentUser ? 'Claim Free 30-Min Test' : 'Sign In to Claim'}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Live Active 30-Minute Trial Countdown Box */}
                  {isLicenseActive && hasClaimedTrial && !isOwner && !userLicenseData.isUnlimited && userLicenseData.expiresAt && (
                    <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-950/80 via-slate-900 to-amber-950/40 border border-emerald-500/50 shadow-xl flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 shrink-0 ring-1 ring-emerald-500/30">
                          <Zap className="w-5 h-5 text-emerald-400 fill-emerald-400 animate-pulse" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-bold text-xs sm:text-sm text-white">⚡ 30-Minute Free Test Active</h4>
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9px] font-bold uppercase tracking-wider">
                              Countdown Running
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-300 mt-0.5 truncate">
                            Your free session is ticking live. Link your WhatsApp below now!
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0 bg-slate-950/90 px-3.5 py-1.5 rounded-xl border border-emerald-500/40 shadow-inner">
                        <span className="text-[9px] text-slate-400 uppercase tracking-wider block font-semibold">Remaining</span>
                        <LicenseCountdown
                          expiresAt={userLicenseData.expiresAt}
                          isUnlimited={false}
                          nowOffsetMs={serverClockOffsetMs}
                        />
                      </div>
                    </div>
                  )}

                  {!isLicenseActive && hasClaimedTrial && (
                    <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-300 text-xs flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                        <div>
                          <p className="font-semibold text-white">License Key Required</p>
                          <p className="text-[11px] text-amber-300/80 mt-0.5">
                            Your 30-minute free trial has ended. Renew with an official license key to reconnect.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('license')}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-[11px] flex items-center gap-1 shrink-0 active:scale-95 cursor-pointer"
                      >
                        <span>Get Key</span>
                        <Zap className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  {status.lastError && status.pairingStage === 'idle' && !status.isConnected && !pairingError && (
                    <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-300 text-xs flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                      <div>
                        <p className="font-semibold text-amber-200">Reconnection Update</p>
                        <p className="text-[11px] text-amber-300/90 mt-0.5 leading-relaxed">{status.lastError}</p>
                      </div>
                    </div>
                  )}

                  {/* Method Switcher: Pairing Code vs QR Code */}
                  <div className="flex rounded-xl bg-slate-900 p-1 border border-slate-800 text-xs">
                    <button
                      type="button"
                      onClick={() => { setPairMethod('code'); setPairingError(null); }}
                      className={`flex-1 py-1.5 rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        pairMethod === 'code'
                          ? 'bg-emerald-600 text-slate-950 shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>8-Digit Pairing Code</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPairMethod('qr');
                        setPairingError(null);
                        if (!status.qrCodeUrl) handleRequestQrCode();
                      }}
                      className={`flex-1 py-1.5 rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        pairMethod === 'qr'
                          ? 'bg-emerald-600 text-slate-950 shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <span>📷 Scan QR Code</span>
                    </button>
                  </div>

                  {/* METHOD 1: 8-DIGIT PAIRING CODE FORM */}
                  {pairMethod === 'code' && (
                    <form onSubmit={handleRequestPairingCode} className="space-y-3">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-300 mb-1">
                          Select Country
                        </label>
                        <CountrySelect
                          selectedCountry={selectedCountry}
                          onSelect={setSelectedCountry}
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-300 mb-1">
                          Phone Number
                        </label>
                        <div className="flex rounded-xl overflow-hidden border border-slate-800 bg-slate-900 focus-within:border-emerald-500 transition-colors">
                          <span className="px-3 py-2.5 bg-slate-950 text-slate-400 text-xs font-mono font-semibold border-r border-slate-800 flex items-center">
                            {selectedCountry.dialCode}
                          </span>
                          <input
                            type="tel"
                            placeholder="e.g. 8012345678"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                            className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none font-mono"
                            required
                          />
                        </div>

                        {phoneNumber.trim() && (
                          <div className="mt-1 text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>
                              Clean WhatsApp format: +{selectedCountry.dialCode.replace(/\D/g, '')}
                              {phoneNumber.replace(/\D/g, '').replace(/^0+/, '')}
                              {phoneNumber.trim().startsWith('0') && ' (leading 0 auto-removed)'}
                            </span>
                          </div>
                        )}
                      </div>

                      <button
                        type="submit"
                        disabled={loading || !phoneNumber}
                        className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-bold text-xs shadow-md disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {loading ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>Connecting to WhatsApp Servers...</span>
                          </>
                        ) : (
                          <>
                            <KeyRound className="w-4 h-4 text-slate-950" />
                            <span>Get 8-Digit Pairing Code</span>
                          </>
                        )}
                      </button>

                      {pairingError && (
                        <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                          <span>{pairingError}</span>
                        </div>
                      )}
                    </form>
                  )}

                  {/* METHOD 2: QR CODE SCANNING */}
                  {pairMethod === 'qr' && (
                    <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-center space-y-3">
                      <h4 className="text-xs font-bold text-white">Scan with WhatsApp Camera</h4>
                      <p className="text-[11px] text-slate-400">
                        Open WhatsApp on your phone &gt; Settings / Menu &gt; Linked Devices &gt; Link a Device &gt; Scan this code.
                      </p>

                      {status.qrCodeUrl ? (
                        <div className="inline-block p-3 bg-white rounded-2xl shadow-xl">
                          <img
                            src={status.qrCodeUrl}
                            alt="WhatsApp Web QR Code"
                            className="w-48 h-48 mx-auto"
                          />
                        </div>
                      ) : (
                        <div className="w-48 h-48 mx-auto flex flex-col items-center justify-center bg-slate-950 rounded-2xl border border-slate-800 text-slate-500 text-xs gap-2">
                          {qrLoading ? (
                            <>
                              <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
                              <span className="text-slate-400">Generating live QR code...</span>
                            </>
                          ) : (
                            <>
                              <span>No active QR code yet</span>
                              <button
                                type="button"
                                onClick={handleRequestQrCode}
                                className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-[11px]"
                              >
                                Generate QR Code
                              </button>
                            </>
                          )}
                        </div>
                      )}

                      <div>
                        <button
                          type="button"
                          onClick={handleRequestQrCode}
                          disabled={qrLoading}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${qrLoading ? 'animate-spin' : ''}`} />
                          <span>{qrLoading ? 'Refreshing QR...' : 'Refresh QR Code'}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Clear instructions when Pairing Code is Generated */}
                  {pairingCode && (
                    <div className="text-[11px] text-slate-300 space-y-3 bg-slate-900/90 p-4 rounded-xl border border-emerald-500/40 shadow-sm animate-in fade-in duration-200">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                        <span className="font-bold text-white flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span>Live WhatsApp Pairing Code Ready</span>
                        </span>
                        <span className="font-mono text-[10px] text-emerald-400 font-bold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                          {status.targetPhone || `+${phoneNumber.replace(/\D/g, '')}`}
                        </span>
                      </div>

                      {/* Prominent explanation about push notifications */}
                      <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 space-y-1.5">
                        <p className="font-bold text-amber-300 flex items-center gap-1.5">
                          <Bell className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>Didn't receive a notification on your phone?</span>
                        </p>
                        <p className="text-[11px] text-amber-200/90 leading-relaxed">
                          This is completely normal! WhatsApp companion codes are <strong>not sent by SMS or chat</strong>, and push notifications are frequently suppressed by Android/iOS battery saver. You do <strong>not</strong> need to wait for a notification!
                        </p>
                      </div>

                      {/* Step by step manual link guide */}
                      <div className="p-3 rounded-xl bg-slate-950 border border-emerald-500/30 space-y-2">
                        <p className="font-bold text-white text-xs">
                          👉 How to link your phone right now (Takes 10 seconds):
                        </p>
                        <ol className="list-decimal list-inside space-y-1.5 text-slate-300 text-[11px]">
                          <li>
                            Copy your code: <strong className="text-emerald-300 font-mono text-xs bg-slate-900 px-1.5 py-0.5 rounded border border-emerald-500/30">{pairingCode}</strong>
                          </li>
                          <li>
                            Open <strong>WhatsApp</strong> on your phone ({status.targetPhone || phoneNumber})
                          </li>
                          <li>
                            Tap <strong>⋮ (3 dots)</strong> on Android or <strong>Settings ⚙️</strong> on iPhone &gt; <strong>Linked Devices</strong>
                          </li>
                          <li>
                            Tap <strong>Link a Device</strong>
                          </li>
                          <li>
                            Look at the bottom of the camera screen and tap <strong className="text-emerald-400">"Link with phone number instead"</strong>
                          </li>
                          <li>
                            Type the 8-digit code <strong className="text-emerald-300 font-mono text-xs">{pairingCode}</strong>
                          </li>
                        </ol>
                      </div>

                      <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-800 italic">
                        ⚡ Once entered, your phone completes the secure companion handshake instantly. The bot will automatically switch to Live 🟢.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: MY GROUPS & ADMIN DEFENSE */}
          {activeTab === 'groups' && (
            <GroupAdminPanel
              isConnected={status.isConnected}
              isPaired={Boolean(status.isPaired || status.user?.phone)}
              isReconnecting={status.state === 'connecting'}
              isLicenseExpired={status.state === 'expired' || !isLicenseActive}
              targetPhone={status.user?.phone || status.targetPhone}
              userId={currentUser?.uid}
              onShowToast={setToastNotification}
              onGoToPair={() => setActiveTab('pair')}
            />
          )}

          {/* TAB 3: LICENSE */}
          {activeTab === 'license' && (
            <div className="space-y-4">
              {/* 30-MINUTE FREE TEST (ONCE IN A LIFETIME PER ACCOUNT) - TAKEN AWAY FOREVER ONCE CLAIMED */}
              {!hasClaimedTrial && (
                <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/70 via-slate-900 to-emerald-950/50 border-2 border-amber-500/60 shadow-xl space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <img
                        src="/solva.webp"
                        alt="SOLVATECH"
                        className="w-10 h-10 rounded-xl object-cover ring-1 ring-amber-500/50 shadow-md shrink-0"
                      />
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-sm text-white">🎁 30-Minute Free Test</h4>
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold uppercase tracking-wider">
                            Once in a Lifetime
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                          Every account gets <strong>30 minutes of free, unrestricted access</strong> to connect WhatsApp and test all bot features! Stacks on top of your balance if activated.
                        </p>
                      </div>
                    </div>
                  </div>

                  {trialMessage && (
                    <div
                      className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                        trialMessage.type === 'success'
                          ? 'bg-emerald-950/50 border border-emerald-500/50 text-emerald-300'
                          : 'bg-rose-950/50 border border-rose-500/50 text-rose-300'
                      }`}
                    >
                      {trialMessage.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      )}
                      <span>{trialMessage.text}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>Status: Ready to Activate (Free)</span>
                    </div>

                    <button
                      type="button"
                      onClick={handleClaim30MinTrial}
                      disabled={claimingTrial}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-emerald-400 hover:from-amber-400 hover:to-emerald-300 text-slate-950 font-black text-xs shadow-lg shadow-amber-950/40 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95"
                    >
                      {claimingTrial ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Activating...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3.5 h-3.5 fill-slate-950" />
                          <span>{currentUser ? 'Activate 30-Min Free Test' : 'Sign In to Activate'}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* NUMBER ONE REQUIREMENT: PROMINENT, BOLD OPAY BANK SHOWCASE */}
              <div className="p-4 sm:p-5 rounded-3xl bg-gradient-to-br from-emerald-950 via-slate-900 to-teal-950 border-2 border-emerald-400/80 shadow-2xl shadow-emerald-950/80 space-y-4 relative overflow-hidden">
                {/* Glowing background accent */}
                <div className="absolute -top-12 -right-12 w-36 h-36 bg-emerald-500/20 rounded-full blur-2xl pointer-events-none" />

                {/* Big Official OPay Bank Header */}
                <div className="flex items-center justify-between border-b border-emerald-500/30 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-400 to-cyan-400 flex items-center justify-center shadow-lg shadow-emerald-500/30 font-black text-slate-950 text-xl tracking-tight">
                      OP
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-black text-base text-white tracking-wide">
                          OPay Bank
                        </h3>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 font-bold text-[10px] tracking-wider uppercase">
                          Official
                        </span>
                      </div>
                      <p className="text-[11px] text-emerald-300/80 font-medium">
                        OPay Microfinance Bank / PayCom
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400 px-2.5 py-1 rounded-xl bg-slate-950 border border-emerald-500/40 font-bold">
                    Instant Credit
                  </span>
                </div>

                {/* Extra Large High-Contrast Account Number Display */}
                <div className="p-4 rounded-2xl bg-slate-950/90 border border-emerald-500/40 space-y-2 text-center shadow-inner">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest block">
                    OPAY ACCOUNT NUMBER
                  </span>
                  <div className="flex items-center justify-center gap-3">
                    <span className="font-mono text-3xl sm:text-4xl font-black text-emerald-400 tracking-widest select-all drop-shadow-sm">
                      {PAYMENT_INFO.accountNumber}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(PAYMENT_INFO.accountNumber);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2500);
                      }}
                      className="p-2.5 rounded-xl bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-all shadow-md font-bold flex items-center gap-1 active:scale-95"
                      title="Copy OPay Number"
                    >
                      {copied ? <Check className="w-4 h-4 stroke-[3]" /> : <Copy className="w-4 h-4" />}
                      <span className="text-xs font-bold hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  {copied && (
                    <p className="text-[11px] font-bold text-emerald-400 animate-in fade-in duration-150">
                      ✓ OPay Account 9049979183 copied to clipboard!
                    </p>
                  )}
                </div>

                {/* Account Details Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Account Name</span>
                    <strong className="text-white text-xs font-bold mt-0.5 block truncate">
                      {PAYMENT_INFO.accountName}
                    </strong>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Bank Name</span>
                    <strong className="text-emerald-300 text-xs font-bold mt-0.5 block truncate">
                      OPay (PayCom)
                    </strong>
                  </div>
                </div>

                {/* Send Proof on WhatsApp Button */}
                <a
                  href={PAYMENT_INFO.whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs transition-all shadow-lg shadow-emerald-950/60 active:scale-[0.98]"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Send Payment Proof to Solomon on WhatsApp</span>
                </a>

                <p className="text-[10px] text-center text-slate-400 leading-tight">
                  Transfer from any Nigerian bank app to this OPay account & tap above to get your instant key!
                </p>
              </div>

              {/* License Plans List - Tap any plan to select / order */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-emerald-400">
                    ⚔️ LICENSE PLANS (TAP TO SELECT)
                  </h4>
                  <span className="text-[10px] text-slate-400 font-mono">OPay Bank Verified</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  {LICENSE_PLANS.map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => {
                        const whatsappMsg = `https://wa.me/2349049979183?text=Hello%20Solomon,%20I%20want%20to%20pay%20${plan.priceFormatted}%20for%20the%20${encodeURIComponent(plan.name)}%20SOLVATECH%20license.`;
                        window.open(whatsappMsg, '_blank');
                      }}
                      className="p-2.5 rounded-xl bg-slate-900 border border-slate-800/90 hover:border-emerald-500/60 hover:bg-slate-850 flex items-center justify-between transition-all active:scale-[0.98] text-left group"
                      title="Tap to order this plan directly on WhatsApp"
                    >
                      <span className="text-slate-300 font-semibold group-hover:text-white">• {plan.name}</span>
                      <strong className="text-emerald-400 font-mono font-bold">{plan.priceFormatted}</strong>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 text-center">
                  💡 Tap any plan above to contact Solomon with your selected order!
                </p>
              </div>

              {/* Redeem License Key Card */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-emerald-400" />
                    <h3 className="font-bold text-sm text-white">Redeem License Key</h3>
                  </div>
                  <span className="text-[10px] text-emerald-400 font-mono">Time Stacking</span>
                </div>

                <p className="text-[11px] text-slate-400">
                  Enter your official license key below. Adding a key automatically stacks duration on top of your existing remaining balance!
                </p>

                <form onSubmit={handleRedeemInTab} className="space-y-3 pt-1">
                  <div>
                    <input
                      type="text"
                      placeholder="Enter License Key (e.g. SOLVA-1D-XXXX-YYYY)"
                      value={inTabKeyInput}
                      onChange={(e) => setInTabKeyInput(e.target.value.toUpperCase())}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono uppercase tracking-wider"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={inTabRedeeming || !inTabKeyInput.trim()}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 text-slate-950 font-bold text-xs shadow-md disabled:opacity-50 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                  >
                    {inTabRedeeming ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin mx-auto" />
                    ) : (
                      'Activate / Add Time to Key'
                    )}
                  </button>

                  {inTabSuccess && (
                    <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs space-y-2">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>{inTabSuccess}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('pair')}
                        className="w-full py-1.5 rounded-lg bg-emerald-600 text-slate-950 font-bold text-[11px]"
                      >
                        Go to Link WhatsApp →
                      </button>
                    </div>
                  )}

                  {inTabError && (
                    <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/40 text-rose-300 text-xs flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>{inTabError}</span>
                    </div>
                  )}
                </form>
              </div>
            </div>
          )}

          {/* TAB 3: COMMANDS (TAP ANY COMMAND TO COPY) */}
          {activeTab === 'commands' && (
            <div className="space-y-3">
              <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    <h3 className="font-bold text-sm text-white">Bot Commands</h3>
                  </div>
                  <span className="text-[10px] text-slate-400">Tap to Copy</span>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search bot command (.ping, .signature, .sticker...)"
                    value={commandSearch}
                    onChange={(e) => setCommandSearch(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5 max-h-[460px] overflow-y-auto pr-1">
                {filteredCommands.map((item) => (
                  <button
                    key={item.cmd}
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(item.cmd);
                      setToastNotification({
                        id: Math.random().toString(),
                        type: 'system',
                        title: 'Command Copied!',
                        body: `Copied ${item.cmd} to clipboard`,
                        timestamp: new Date().toLocaleTimeString(),
                      });
                      setTimeout(() => setToastNotification(null), 2500);
                    }}
                    className="w-full text-left p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 hover:border-emerald-500/50 hover:bg-slate-900/60 flex items-start justify-between gap-2 transition-all active:scale-[0.99] group"
                  >
                    <div>
                      <span className="font-mono text-emerald-400 group-hover:text-emerald-300 font-bold text-xs">
                        {item.cmd}
                      </span>
                      <p className="text-[11px] text-slate-400 mt-0.5">{item.desc}</p>
                    </div>
                    <Copy className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400 shrink-0 mt-0.5" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Nav - Tip-Down Floating Bar (Non-movable, pinned to bottom) */}
        <nav className="shrink-0 z-40 px-2.5 py-2 bg-slate-950/95 backdrop-blur-md border-t border-slate-800/90 shadow-2xl pb-[max(0.6rem,env(safe-area-inset-bottom))]">
          <div className={`grid ${isOwner ? 'grid-cols-5' : 'grid-cols-4'} gap-1 text-[10px]`}>
            <button
              type="button"
              onClick={() => setActiveTab('pair')}
              className={`flex flex-col items-center justify-center gap-1 py-1.5 px-1 rounded-xl transition-all cursor-pointer ${
                activeTab === 'pair'
                  ? 'bg-emerald-500/15 text-emerald-400 font-bold border border-emerald-500/30 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <KeyRound className="w-4 h-4 shrink-0" />
              <span className="truncate">Link</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('groups')}
              className={`flex flex-col items-center justify-center gap-1 py-1.5 px-1 rounded-xl transition-all relative cursor-pointer ${
                activeTab === 'groups'
                  ? 'bg-emerald-500/15 text-emerald-400 font-bold border border-emerald-500/30 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <div className="relative">
                <Crown className="w-4 h-4 shrink-0" />
                {status.isConnected && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute -top-0.5 -right-1" />
                )}
              </div>
              <span className="truncate">Groups</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('license')}
              className={`flex flex-col items-center justify-center gap-1 py-1.5 px-1 rounded-xl transition-all cursor-pointer ${
                activeTab === 'license'
                  ? 'bg-emerald-500/15 text-emerald-400 font-bold border border-emerald-500/30 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <Key className="w-4 h-4 shrink-0" />
              <span className="truncate">License</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('commands')}
              className={`flex flex-col items-center justify-center gap-1 py-1.5 px-1 rounded-xl transition-all cursor-pointer ${
                activeTab === 'commands'
                  ? 'bg-emerald-500/15 text-emerald-400 font-bold border border-emerald-500/30 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <Terminal className="w-4 h-4 shrink-0" />
              <span className="truncate">Commands</span>
            </button>

            {isOwner && (
              <button
                type="button"
                onClick={() => setIsAdminModalOpen(true)}
                className="flex flex-col items-center justify-center gap-1 py-1.5 px-1 rounded-xl text-amber-400 hover:text-amber-300 hover:bg-amber-500/15 border border-amber-500/30 bg-amber-500/10 transition-all cursor-pointer shadow-xs"
              >
                <Zap className="w-4 h-4 shrink-0 fill-amber-400/40 text-amber-400" />
                <span className="font-bold truncate">Admin OS</span>
              </button>
            )}
          </div>
        </nav>
      </div>

      {/* Notifications Panel */}
      <NotificationsPanel
        isOpen={isNotificationsOpen}
        notifications={notifications}
        onClose={() => setIsNotificationsOpen(false)}
        onClear={handleClearNotifications}
        isConnected={status.isConnected}
        userId={currentUser?.uid}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onSuccess={(user) => {
          setCurrentUser(user);
          setIsAuthModalOpen(false);
        }}
        onClose={() => setIsAuthModalOpen(false)}
      />

      {/* Admin Dashboard - Strictly restricted to verified owner */}
      {isOwner && isAdminModalOpen && (
        <AdminDashboard
          currentUserEmail={currentUser?.email}
          currentUserId={currentUser?.uid}
          onClose={() => setIsAdminModalOpen(false)}
        />
      )}

      {/* Offline Mode Indicator */}
      <OfflineIndicator />
    </div>
  );
}
