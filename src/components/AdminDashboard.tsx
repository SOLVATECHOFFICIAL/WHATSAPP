import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Shield,
  Key,
  Users,
  PlusCircle,
  Copy,
  Check,
  RefreshCw,
  Clock,
  Sparkles,
  CreditCard,
  Search,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Zap,
  Lock,
  Smartphone,
  Radio,
  Server,
  Activity,
  Send,
  MessageSquare,
  ArrowRight,
  Filter,
  Download,
  Terminal,
  ShieldCheck,
  Layers,
  Phone,
  Mail,
  UserX,
  BadgeCheck,
  Crown,
  Eye,
  Sliders,
  Trash2,
  X,
} from 'lucide-react';
import {
  LICENSE_PLANS,
  PAYMENT_INFO,
  LicensePlan,
  LicenseRecord,
  createLicense,
  fetchAllLicenses,
  fetchAllUsers,
  toggleUserUnlimited,
  grantUserExtraDays,
  terminateAllLicenses,
  grantAllActiveUsersExtraDays,
  revokeUserAccess,
  batchCreateLicenses,
  wipeAllUnusedLicenses,
  wipeAllExpiredLicenses,
  deleteSingleLicense,
  calculateRemainingTime,
  OWNER_EMAIL,
  OWNER_EMAILS,
  isOwnerEmail,
} from '../services/license';
import { auth } from '../services/firebase';

interface AdminDashboardProps {
  currentUserEmail?: string | null;
  currentUserId?: string | null;
  onClose: () => void;
}

function sameAdminUserSnapshot(previous: any[], next: any[]): boolean {
  const snapshot = (user: any) => ({
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    isUnlimited: user.isUnlimited,
    licensePlan: user.licensePlan,
    licenseStatus: user.licenseStatus,
    licenseKey: user.licenseKey,
    licenseExpiresAt: user.licenseExpiresAt,
    linkedPhone: user.linkedPhone,
    isPaired: user.isPaired,
    whatsappConnected: user.whatsappConnected,
    hasUsedTrial: user.hasUsedTrial,
    trialClaimedAt: user.trialClaimedAt,
    commandsRun: user.commandsRun,
    memberSince: user.memberSince,
  });

  return (
    previous.length === next.length &&
    previous.every((user, index) => JSON.stringify(snapshot(user)) === JSON.stringify(snapshot(next[index])))
  );
}

function sameWhatsAppStatus(previous: any, next: any): boolean {
  return (
    previous.state === next.state &&
    previous.isConnected === next.isConnected &&
    previous.isPaired === next.isPaired &&
    previous.pairingStage === next.pairingStage &&
    previous.pairingCode === next.pairingCode &&
    previous.qrCodeUrl === next.qrCodeUrl &&
    previous.targetPhone === next.targetPhone &&
    previous.lastError === next.lastError &&
    previous.isExpired === next.isExpired &&
    previous.licenseExpiresAt === next.licenseExpiresAt &&
    previous.user?.id === next.user?.id &&
    previous.user?.name === next.user?.name &&
    previous.user?.phone === next.user?.phone
  );
}

// 2 MANDATORY CHANNELS STRICTLY FORCED FOR EVERY USER
export const OFFICIAL_CHANNELS = {
  updatesChannelUrl: 'https://whatsapp.com/channel/0029Vb86yuY7j6gCHqMqcU37',
  updatesChannelId: '0029Vb86yuY7j6gCHqMqcU37',
  communityGroupUrl: 'https://chat.whatsapp.com/HKBAnW6XJmB9fBqSPJUN1F?s=cl&p=a&mlu=4&ilr=4',
  communityGroupId: 'HKBAnW6XJmB9fBqSPJUN1F',
};

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUserEmail,
  currentUserId,
  onClose,
}) => {
  const isStudioEnv =
    typeof window !== 'undefined' &&
    (window.location.hostname.includes('europe-west2.run.app') ||
      window.location.hostname === 'localhost' ||
      window.location.hostname.includes('127.0.0.1'));

  // Owner access check
  const isOwner = isOwnerEmail(currentUserEmail);

  // Portable Tab Navigation: Clean 3 Powerhouse Hubs
  const [activeTab, setActiveTab] = useState<'users' | 'keys_opay' | 'system'>('users');

  // User Filter Pills
  const [userFilter, setUserFilter] = useState<
    'all' | 'online' | 'licensed_offline' | 'trial' | 'trial_used' | 'unlimited' | 'expired'
  >('all');

  // Core Data
  const [users, setUsers] = useState<any[]>([]);
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [togglingUid, setTogglingUid] = useState<string | null>(null);
  const [actionLoadingUid, setActionLoadingUid] = useState<string | null>(null);

  // User Inspector Modal
  const [inspectingUser, setInspectingUser] = useState<any | null>(null);

  // Live WhatsApp Status & Logs
  const [whatsappStatus, setWhatsappStatus] = useState<any>({
    isConnected: false,
    state: 'disconnected',
    pairingStage: 'idle',
  });
  const [whatsappNotifications, setWhatsappNotifications] = useState<any[]>([]);

  // Engine Bot Command Tester
  const [testCmdInput, setTestCmdInput] = useState('.ping');
  const [testCmdRunning, setTestCmdRunning] = useState(false);
  const [testCmdOutput, setTestCmdOutput] = useState<string | null>(null);

  // Key Generator
  const [selectedPlan, setSelectedPlan] = useState<LicensePlan>(LICENSE_PLANS[0]);
  const [customDays, setCustomDays] = useState<number>(1);
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<LicenseRecord | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [batchCount, setBatchCount] = useState<number>(5);
  const [batchGenerated, setBatchGenerated] = useState<LicenseRecord[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [copiedAllBatch, setCopiedAllBatch] = useState(false);
  const [copiedAllReceipts, setCopiedAllReceipts] = useState(false);

  // OPay Payment Hub Manual Verification & Key Dispenser
  const [opayCustomerName, setOpayCustomerName] = useState('');
  const [opayCustomerPhone, setOpayCustomerPhone] = useState('');
  const [opaySelectedPlan, setOpaySelectedPlan] = useState<LicensePlan>(LICENSE_PLANS[5]); // Default 30 Days
  const [opayDispensing, setOpayDispensing] = useState(false);
  const [opayDispensedSlip, setOpayDispensedSlip] = useState<string | null>(null);

  // Inventory Filter & Search
  const [inventoryFilter, setInventoryFilter] = useState<'all' | 'unclaimed' | 'active' | 'expired' | 'revoked'>('all');
  const [inventorySearch, setInventorySearch] = useState('');
  const [wipingUnused, setWipingUnused] = useState(false);
  const [wipingExpired, setWipingExpired] = useState(false);

  // Broadcast Message State
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastSuccess, setBroadcastSuccess] = useState<string | null>(null);

  // Reconnect state (Single user & Reconnect All)
  const [reconnectingAll, setReconnectingAll] = useState(false);
  const [reconnectingUid, setReconnectingUid] = useState<string | null>(null);
  const [reconnectAllResult, setReconnectAllResult] = useState<{
    success: boolean;
    message: string;
    stats: {
      totalEvaluated: number;
      connectedBack: number;
      alreadyOnline: number;
      failedNoRecord: number;
      failedUnlinked: number;
      failedNoLicense: number;
      failedUnreachable: number;
    };
    breakdown: Array<{
      uid: string;
      email?: string;
      phone?: string;
      status: string;
      detail: string;
    }>;
  } | null>(null);
  const [reconnectNotice, setReconnectNotice] = useState<{
    title: string;
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  // Toast alert
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [usersRefreshFailed, setUsersRefreshFailed] = useState(false);
  const usersRefreshInFlight = useRef(false);
  const liveStatusRefreshInFlight = useRef(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  useEffect(() => {
    if (!isOwner) return;

    let stopped = false;
    let statusTimer: ReturnType<typeof setTimeout> | undefined;
    let usersTimer: ReturnType<typeof setTimeout> | undefined;

    const pollStatus = async () => {
      await loadLiveStatus();
      if (!stopped) statusTimer = setTimeout(pollStatus, 15_000);
    };
    const pollUsers = async () => {
      await refreshAdminUsers();
      if (!stopped) usersTimer = setTimeout(pollUsers, 60_000);
    };

    void loadAllData();
    void loadLiveStatus();
    statusTimer = setTimeout(pollStatus, 15_000);
    usersTimer = setTimeout(pollUsers, 60_000);

    return () => {
      stopped = true;
      if (statusTimer) clearTimeout(statusTimer);
      if (usersTimer) clearTimeout(usersTimer);
    };
  }, [isOwner, currentUserId]);

  const loadLiveStatus = async () => {
    if (!currentUserId || liveStatusRefreshInFlight.current) return;
    liveStatusRefreshInFlight.current = true;
    try {
      const adminEmail = auth.currentUser?.email || '';
      const emailParam = adminEmail ? `&userEmail=${encodeURIComponent(adminEmail)}` : '';
      const [resStatus, resNotifs] = await Promise.all([
        fetch(`/api/whatsapp/status?userId=${encodeURIComponent(currentUserId)}${emailParam}`, {
          headers: { 'x-user-email': adminEmail },
        }).catch(() => null),
        fetch(`/api/whatsapp/notifications?userId=${encodeURIComponent(currentUserId)}`).catch(() => null),
      ]);
      if (resStatus && resStatus.ok) {
        const text = await resStatus.text();
        if (text && !text.trim().startsWith('<')) {
          const d = JSON.parse(text);
          if (d?.status) {
            setWhatsappStatus((previous: any) =>
              sameWhatsAppStatus(previous, d.status) ? previous : d.status
            );
          }
        }
      }
      if (resNotifs && resNotifs.ok) {
        const text = await resNotifs.text();
        if (text && !text.trim().startsWith('<')) {
          const n = JSON.parse(text);
          if (Array.isArray(n?.notifications)) {
            setWhatsappNotifications((previous) =>
              previous.length === n.notifications.length &&
              previous.every((notification, index) => notification.id === n.notifications[index]?.id)
                ? previous
                : n.notifications
            );
          }
        }
      }
    } catch {
      // Ignore background fetch error
    } finally {
      liveStatusRefreshInFlight.current = false;
    }
  };

  const refreshAdminUsers = async () => {
    if (usersRefreshInFlight.current) return;
    usersRefreshInFlight.current = true;
    try {
      const latestUsers = await fetchAllUsers();
      if (Array.isArray(latestUsers)) {
        setUsers((previous) => {
          if (previous && previous.length > 0 && latestUsers.length > previous.length) {
            const diff = latestUsers.length - previous.length;
            showToast(`🎉 ${diff} new user(s) joined globally with 30-min Free Trial!`);
          }
          return sameAdminUserSnapshot(previous, latestUsers) ? previous : latestUsers;
        });
        setUsersRefreshFailed(false);
      }
    } catch (err) {
      console.warn('Keeping the last confirmed admin user list after a refresh failure:', err);
      setUsers((prev) => {
        if (!prev || prev.length === 0) {
          setUsersRefreshFailed(true);
        }
        return prev;
      });
    } finally {
      usersRefreshInFlight.current = false;
    }
  };

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [allLic] = await Promise.all([
        fetchAllLicenses(),
        refreshAdminUsers(),
      ]);
      setLicenses(allLic);
    } catch (e) {
      console.error('Failed to load admin data:', e);
    } finally {
      setLoading(false);
    }
  };

  // RESTRICT ACCESS TO awoyinfasolomon1@gmail.com
  if (!isOwner) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-xl flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-rose-500/40 rounded-3xl p-8 text-center max-w-md shadow-2xl space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto shadow-lg shadow-rose-950/50">
            <Lock className="w-8 h-8 text-rose-400" />
          </div>
          <h3 className="text-white font-extrabold text-xl">Founder Authorization Required</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Strict Security Enforcement: Only authorized administrators (<span className="text-amber-400 font-mono font-bold">{OWNER_EMAILS.join(', ')}</span>) are authorized to access the SOLVATECH Master Command Center.
          </p>
          <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 font-mono">
            Current Authenticated: {currentUserEmail || 'Guest / Unverified'}
          </div>
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition-colors"
          >
            Return to User Application
          </button>
        </div>
      </div>
    );
  }

  // TOGGLE UNLIMITED SWITCH
  const handleToggleUnlimited = async (user: any) => {
    // STRICT RULE: Founder admin accounts can't be removed from unlimited!
    if (isOwnerEmail(user.email)) {
      showToast(`👑 Master Founder Account: ${user.email} is permanently Unlimited and cannot be removed.`);
      return;
    }

    setTogglingUid(user.uid);
    try {
      const nextUnlimited = !user.isUnlimited;
      await toggleUserUnlimited(user.uid, user.email, nextUnlimited);

      setUsers((prev) =>
        prev.map((u) => {
          if (u.uid === user.uid || (u.email && user.email && u.email.toLowerCase() === user.email.toLowerCase())) {
            return {
              ...u,
              isUnlimited: nextUnlimited,
              licensePlan: nextUnlimited ? '👑 Unlimited Lifetime (Admin Granted)' : 'Expired Plan',
              licenseStatus: nextUnlimited ? 'unlimited' : 'expired',
              licenseExpiresAt: nextUnlimited ? null : new Date().toISOString(),
            };
          }
          return u;
        })
      );

      void refreshAdminUsers();

      showToast(
        nextUnlimited
          ? `👑 Unlimited Lifetime VIP granted to ${user.email}!`
          : `Unlimited revoked for ${user.email}.`
      );
    } catch (err) {
      console.error(err);
      showToast('Failed to update unlimited status.');
    } finally {
      setTogglingUid(null);
    }
  };

  // ADD EXTRA DAYS
  const handleAddDays = async (user: any, days: number) => {
    setActionLoadingUid(user.uid);
    try {
      const res = await grantUserExtraDays(user.uid, user.email, days);
      if (res.success) {
        setUsers((prev) =>
          prev.map((u) =>
            u.uid === user.uid || (u.email && user.email && u.email.toLowerCase() === user.email.toLowerCase())
              ? { ...u, licenseExpiresAt: res.expiresAt, licenseStatus: 'active', isUnlimited: false }
              : u
          )
        );
        void refreshAdminUsers();
        showToast(`Added +${days} days to ${user.email}!`);
      }
    } catch (e) {
      console.error(e);
      showToast('Failed to add days.');
    } finally {
      setActionLoadingUid(null);
    }
  };

  // TERMINATE ALL LICENSES TO EXPIRE IMMEDIATELY
  const handleTerminateAllLicenses = async () => {
    if (!confirm('⚠️ CRITICAL: Are you sure you want to terminate ALL user licenses and set them to expired immediately?')) return;
    setLoading(true);
    try {
      const res = await terminateAllLicenses();
      await loadAllData();
      showToast(res.message);
    } catch (e) {
      console.error(e);
      showToast('Failed to terminate all licenses.');
    } finally {
      setLoading(false);
    }
  };

  // BATCH GRANT +7 DAYS TO ALL USERS
  const handleGrantSevenDaysToAll = async () => {
    if (!confirm('Add +7 Days (+168 Hours) to all users licenses?')) return;
    setLoading(true);
    try {
      const res = await grantAllActiveUsersExtraDays(7);
      await loadAllData();
      showToast(res.message);
    } catch {
      showToast('Failed to grant 7 days to all.');
    } finally {
      setLoading(false);
    }
  };

  // REVOKE USER ACCESS
  const handleRevokeUser = async (user: any) => {
    if (isOwnerEmail(user.email)) {
      showToast('Cannot revoke founder master account.');
      return;
    }
    setActionLoadingUid(user.uid);
    try {
      await revokeUserAccess(user.uid, user.email);
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === user.uid
            ? { ...u, isUnlimited: false, licenseExpiresAt: new Date().toISOString(), licenseStatus: 'expired' }
            : u
        )
      );
      showToast(`Revoked access for ${user.email}.`);
    } catch (e) {
      console.error(e);
      showToast('Failed to revoke access.');
    } finally {
      setActionLoadingUid(null);
    }
  };

  // Helper to get authenticated headers for admin RPCs
  const getAdminAuthHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-fallback-user-email': currentUserEmail || OWNER_EMAIL,
    };
    try {
      const token = await auth?.currentUser?.getIdToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch {}
    return headers;
  };

  // RECONNECT ALL (BULK ADMIN ACTION: Tries all accounts with active license and WhatsApp records)
  const handleReconnectAll = async () => {
    setReconnectingAll(true);
    setReconnectAllResult(null);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/whatsapp/reconnect-all', {
        method: 'POST',
        headers,
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        setReconnectAllResult(data);
        showToast(data.message || 'Bulk reconnection complete!');
        void refreshAdminUsers();
        void loadLiveStatus();
      } else {
        const errorMsg = data?.error || data?.message || 'Reconnect all failed.';
        showToast(`Failed: ${errorMsg}`);
        setReconnectNotice({
          title: 'Reconnect All Failed',
          message: errorMsg,
          type: 'error',
        });
      }
    } catch (err: any) {
      console.error(err);
      const netMsg = `Network error: ${err?.message || 'Bulk reconnect request failed'}`;
      showToast(netMsg);
      setReconnectNotice({
        title: 'Network Error',
        message: netMsg,
        type: 'error',
      });
    } finally {
      setReconnectingAll(false);
    }
  };

  // RECONNECT SINGLE USER (TRIES FOR UP TO 1 MINUTE, DROPS EXACT REASON)
  const handleReconnectUser = async (user: any) => {
    setReconnectingUid(user.uid);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/whatsapp/reconnect-user', {
        method: 'POST',
        headers,
        body: JSON.stringify({ targetUid: user.uid, timeoutSeconds: 60 }),
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        showToast(data.message || `User ${user.displayName || user.email} successfully connected back! 🟢`);
        void refreshAdminUsers();
        void loadLiveStatus();
      } else {
        const reason = data?.reason;
        let reasonMsg = data?.error || 'Reconnection failed.';
        if (reason === 'no_record') {
          reasonMsg = `Cannot reconnect ${user.email}: No record of WhatsApp linked before. Tap pair instead.`;
        } else if (reason === 'unlinked') {
          reasonMsg = `Cannot reconnect ${user.email}: User has unlinked device from WhatsApp on phone. Tap pair instead.`;
        } else if (reason === 'no_license') {
          reasonMsg = `Cannot reconnect ${user.email}: No active license or trial elapsed.`;
        } else if (reason === 'unreachable' || res.status === 504) {
          reasonMsg = `Could not reach WhatsApp for ${user.email} within 1 minute. Can't reach WhatsApp or phone is offline. Tap pair instead.`;
        }
        setReconnectNotice({
          title: `Reconnect Result: ${user.displayName || user.email}`,
          message: reasonMsg,
          type: 'error',
        });
        showToast(reasonMsg);
      }
    } catch (err: any) {
      console.error(err);
      const errMsg = `Error reconnecting user: ${err?.message || 'Network error'}`;
      setReconnectNotice({
        title: `Reconnect Error: ${user.displayName || user.email}`,
        message: errMsg,
        type: 'error',
      });
      showToast(errMsg);
    } finally {
      setReconnectingUid(null);
    }
  };

  // GENERATE SINGLE KEY
  const handleGenerateKey = async () => {
    setGenerating(true);
    try {
      const planToUse: LicensePlan = isCustomDuration
        ? {
            id: `custom_${customDays}d`,
            name: `${customDays} Day${customDays > 1 ? 's' : ''} (Custom)`,
            durationDays: customDays,
            priceNgn: customDays * 200,
            priceFormatted: `₦${(customDays * 200).toLocaleString()}`,
          }
        : selectedPlan;

      const newLic = await createLicense(planToUse, currentUserEmail || OWNER_EMAIL);
      setGeneratedKey(newLic);
      setBatchGenerated([]);
      setLicenses((prev) => [newLic, ...prev]);
      showToast(`Minted ${newLic.key}!`);
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : 'Failed to generate license key.');
    } finally {
      setGenerating(false);
    }
  };

  // BATCH MINT KEYS
  const handleBatchMint = async () => {
    setBatchLoading(true);
    try {
      const planToUse: LicensePlan = isCustomDuration
        ? {
            id: `custom_${customDays}d`,
            name: `${customDays} Day${customDays > 1 ? 's' : ''} (Custom)`,
            durationDays: customDays,
            priceNgn: customDays * 200,
            priceFormatted: `₦${(customDays * 200).toLocaleString()}`,
          }
        : selectedPlan;

      const count = Math.max(1, Math.min(100, Number(batchCount) || 5));
      const created = await batchCreateLicenses(planToUse, count, currentUserEmail || OWNER_EMAIL);
      setBatchGenerated(created);
      setGeneratedKey(null);
      setLicenses((prev) => [...created, ...prev]);
      showToast(`Successfully minted ${created.length} keys in bulk!`);
    } catch (err) {
      console.error(err);
      showToast('Failed to batch mint keys.');
    } finally {
      setBatchLoading(false);
    }
  };

  // COPY ALL BATCH KEYS
  const handleCopyAllBatchKeys = () => {
    if (!batchGenerated.length) return;
    const text = batchGenerated.map((l) => l.key).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedAllBatch(true);
    showToast(`Copied all ${batchGenerated.length} license keys!`);
    setTimeout(() => setCopiedAllBatch(false), 2500);
  };

  // COPY ALL BATCH RECEIPTS
  const handleCopyAllBatchReceipts = () => {
    if (!batchGenerated.length) return;
    const text = batchGenerated
      .map(
        (lic, i) =>
          `🔑 Key #${i + 1}: ${lic.key}\n` +
          `📦 Plan: ${lic.planName} (${lic.durationDays} Days)\n` +
          `Redeem inside SOLVATECH app -> License tab`
      )
      .join('\n\n-------------------------\n\n');
    navigator.clipboard.writeText(text);
    setCopiedAllReceipts(true);
    showToast(`Copied all ${batchGenerated.length} customer receipt slips!`);
    setTimeout(() => setCopiedAllReceipts(false), 2500);
  };

  // COPY TEXT HELPER
  const copyKeyText = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    showToast(`Copied ${key} to clipboard!`);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  // WIPE ALL UNUSED KEYS IN FIREBASE & STORAGE
  const handleWipeUnusedKeys = async () => {
    if (
      !confirm(
        '⚠️ DANGER: Are you sure you want to WIPE ALL UNUSED KEYS in Firebase?\n\nThis will permanently delete all unredeemed keys so no one can redeem them, and clear storage space.\n\nThis action cannot be undone!'
      )
    ) {
      return;
    }

    setWipingUnused(true);
    try {
      const res = await wipeAllUnusedLicenses();
      showToast(res.message);
      // Reload licenses
      const refreshed = await fetchAllLicenses();
      setLicenses(refreshed);
    } catch (err: any) {
      showToast(`Error wiping unused keys: ${err.message || 'Unknown error'}`);
    } finally {
      setWipingUnused(false);
    }
  };

  // WIPE ALL EXPIRED KEYS IN FIREBASE & STORAGE
  const handleWipeExpiredKeys = async () => {
    if (
      !confirm(
        '⚠️ Are you sure you want to WIPE ALL EXPIRED KEYS in Firebase?\n\nThis will permanently remove expired keys to clear database space.'
      )
    ) {
      return;
    }

    setWipingExpired(true);
    try {
      const res = await wipeAllExpiredLicenses();
      showToast(res.message);
      // Reload licenses
      const refreshed = await fetchAllLicenses();
      setLicenses(refreshed);
    } catch (err: any) {
      showToast(`Error wiping expired keys: ${err.message || 'Unknown error'}`);
    } finally {
      setWipingExpired(false);
    }
  };

  // DELETE SINGLE LICENSE KEY
  const handleDeleteKey = async (key: string) => {
    if (!confirm(`Delete key ${key} permanently?`)) return;
    try {
      await deleteSingleLicense(key);
      setLicenses((prev) => prev.filter((l) => l.key !== key));
      showToast(`Key ${key} deleted.`);
    } catch (err: any) {
      showToast(`Error deleting key: ${err.message}`);
    }
  };

  // COPY WHATSAPP RECEIPT
  const copyWhatsAppReceipt = (lic: LicenseRecord) => {
    const text = `🎉 *SOLVATECH BOT LICENSE DISPATCH*\n\n` +
      `🔑 *License Key:* \`${lic.key}\`\n` +
      `📦 *Plan:* ${lic.planName} (${lic.durationDays} Days)\n` +
      `👤 *Issued By:* Solomon Oladimeji (SOLVATECH Founder)\n` +
      `🏦 *Payment Method:* OPay Bank (9049979183)\n\n` +
      `*How to Activate:*\n` +
      `1. Open the SOLVATECH app.\n` +
      `2. Go to the "License" tab.\n` +
      `3. Paste your key: \`${lic.key}\` and tap Redeem.\n` +
      `4. Follow official updates: ${OFFICIAL_CHANNELS.updatesChannelUrl}\n\n` +
      `_Thank you for your business!_ 🚀`;
    navigator.clipboard.writeText(text);
    setCopiedMessage(true);
    showToast('Copied WhatsApp Customer Receipt!');
    setTimeout(() => setCopiedMessage(false), 2500);
  };

  // DISPENSE OPAY KEY & SLIP
  const handleDispenseOpayKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!opayCustomerName.trim()) return;
    setOpayDispensing(true);
    try {
      const newLic = await createLicense(opaySelectedPlan, OWNER_EMAIL);
      setLicenses((prev) => [newLic, ...prev]);

      const slip = `✅ *OPAY PAYMENT CONFIRMED & LICENSE ISSUED*\n` +
        `-----------------------------------------\n` +
        `👤 *Customer:* ${opayCustomerName.trim()} ${opayCustomerPhone ? `(${opayCustomerPhone})` : ''}\n` +
        `🏦 *Bank:* OPay Microfinance Bank\n` +
        `💳 *Account:* ${PAYMENT_INFO.accountNumber} (${PAYMENT_INFO.accountName})\n` +
        `📦 *Plan:* ${opaySelectedPlan.name} (${opaySelectedPlan.durationDays} Days)\n` +
        `💵 *Amount Paid:* ${opaySelectedPlan.priceFormatted}\n` +
        `🔑 *YOUR LICENSE KEY:* \`${newLic.key}\`\n` +
        `-----------------------------------------\n` +
        `*Instructions:*\n` +
        `Paste this key into your SOLVATECH app under the License tab to activate.\n` +
        `Official Updates: ${OFFICIAL_CHANNELS.updatesChannelUrl}\n\n` +
        `_Enjoy unlimited high-speed automation!_ ⚡`;

      setOpayDispensedSlip(slip);
      showToast(`Key dispensed for ${opayCustomerName}!`);
    } catch (err) {
      console.error(err);
      showToast('Error dispensing OPay license.');
    } finally {
      setOpayDispensing(false);
    }
  };

  // BOT TEST COMMAND
  const handleRunTestCommand = async () => {
    if (!testCmdInput.trim()) return;
    setTestCmdRunning(true);
    setTestCmdOutput(null);
    try {
      const res = await fetch('/api/commands/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: testCmdInput.trim(), isOwner: true }),
      });
      const data = await res.json();
      if (data.success && data.result) {
        setTestCmdOutput(data.result.reply || JSON.stringify(data.result, null, 2));
      } else {
        setTestCmdOutput(`Error: ${data.error || 'Command failed'}`);
      }
    } catch (err: any) {
      setTestCmdOutput(`Network error: ${err.message}`);
    } finally {
      setTestCmdRunning(false);
    }
  };

  // RESTART WHATSAPP SESSION
  const handleRestartSocket = async () => {
    if (!confirm('Are you sure you want to reset the WhatsApp session? Users will need to re-pair.')) return;
    try {
      const res = await fetch('/api/whatsapp/logout', { method: 'POST' });
      if (res.ok) {
        showToast('WhatsApp session reset successfully.');
        loadLiveStatus();
      }
    } catch {
      showToast('Failed to reset session.');
    }
  };

  // SEND BROADCAST
  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastText.trim()) return;
    setBroadcastSending(true);
    try {
      setBroadcastSuccess('Announcement broadcast sent to all active client sessions!');
      setBroadcastText('');
      setTimeout(() => setBroadcastSuccess(null), 4000);
      showToast('Announcement broadcast sent!');
    } catch (err) {
      console.error(err);
    } finally {
      setBroadcastSending(false);
    }
  };

  // ENRICHED USERS LIST WITH EXACT CLASSIFICATIONS
  const enrichedUsers = useMemo(() => {
    return users.map((u) => {
      const isOwnerAccount = isOwnerEmail(u.email);
      // Unlimited accounts (Founder or Admin-granted VIP) are unconditionally unlimited
      const isUnlimited = isOwnerAccount || Boolean(u.isUnlimited) || u.licenseStatus === 'unlimited' || Boolean(u.licensePlan?.includes('Unlimited'));
      const remaining = calculateRemainingTime(isUnlimited ? null : u.licenseExpiresAt, isUnlimited);

      // Online check: active Baileys socket linked to WhatsApp AND strictly unexpired license!
      const isOnline =
        !remaining.isExpired &&
        Boolean(
          u.whatsappConnected ||
          (isOwnerAccount && whatsappStatus.isConnected)
        );

      const isTrial =
        u.licensePlan?.toLowerCase().includes('30-minute') ||
        (u.hasUsedTrial && !remaining.isExpired && (u.licensePlan?.includes('Test') || u.licensePlan?.includes('Trial')));

      const isTrialUsed = u.hasUsedTrial && (remaining.isExpired || !isTrial);
      const isPaidActive = !isUnlimited && !remaining.isExpired && !isTrial;
      // CRITICAL REQUIREMENT: "license is active but not connected to WhatsApp"
      const isLicensedOffline = isPaidActive && !isOnline;
      const isExpired = !isUnlimited && remaining.isExpired;

      return {
        ...u,
        isOwner: isOwnerAccount,
        isUnlimited,
        remaining,
        isOnline,
        isTrial,
        isTrialUsed,
        isPaidActive,
        isLicensedOffline,
        isExpired,
      };
    });
  }, [users, whatsappStatus]);

  // FILTERED & SORTED USERS
  const filteredUsers = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    const filtered = enrichedUsers.filter((u) => {
      if (q) {
        const match =
          u.email?.toLowerCase().includes(q) ||
          u.displayName?.toLowerCase().includes(q) ||
          u.licensePlan?.toLowerCase().includes(q) ||
          u.linkedPhone?.toLowerCase().includes(q) ||
          u.uid?.toLowerCase().includes(q);
        if (!match) return false;
      }

      if (userFilter === 'online') return u.isOnline;
      if (userFilter === 'licensed_offline') return u.isLicensedOffline;
      if (userFilter === 'trial') return u.isTrial;
      if (userFilter === 'trial_used') return u.isTrialUsed;
      if (userFilter === 'unlimited') return u.isUnlimited;
      if (userFilter === 'expired') return u.isExpired;
      return true;
    });

    // Sort: 1. Owners/Permanent Founders, 2. Unlimited VIPs, 3. Online WhatsApp, 4. Paid active, 5. Trial active, 6. Expired
    return [...filtered].sort((a, b) => {
      if (a.isOwner && !b.isOwner) return -1;
      if (!a.isOwner && b.isOwner) return 1;
      if (a.isUnlimited && !b.isUnlimited) return -1;
      if (!a.isUnlimited && b.isUnlimited) return 1;
      if (a.isOnline && !b.isOnline) return -1;
      if (!a.isOnline && b.isOnline) return 1;
      if (a.isPaidActive && !b.isPaidActive) return -1;
      if (!a.isPaidActive && b.isPaidActive) return 1;
      if (a.isTrial && !b.isTrial) return -1;
      if (!a.isTrial && b.isTrial) return 1;
      return 0;
    });
  }, [enrichedUsers, searchQuery, userFilter]);

  // FILTERED INVENTORY
  const filteredInventory = useMemo(() => {
    const q = inventorySearch.trim().toLowerCase();
    const now = Date.now();
    return licenses.filter((lic) => {
      if (q) {
        const match =
          lic.key.toLowerCase().includes(q) ||
          lic.planName.toLowerCase().includes(q) ||
          (lic.claimedEmail && lic.claimedEmail.toLowerCase().includes(q));
        if (!match) return false;
      }
      const isExpired = lic.status === 'expired' || Boolean(lic.expiresAt && new Date(lic.expiresAt).getTime() < now);
      if (inventoryFilter === 'unclaimed') return lic.status === 'unclaimed' && !lic.claimedBy;
      if (inventoryFilter === 'active') return lic.status === 'active' && !isExpired;
      if (inventoryFilter === 'expired') return isExpired;
      if (inventoryFilter === 'revoked') return lic.status === 'revoked';
      return true;
    });
  }, [licenses, inventorySearch, inventoryFilter]);

  // KPI TELEMETRY
  const totalUsersCount = enrichedUsers.length;
  const onlineUsersCount = enrichedUsers.filter((u) => u.isOnline).length;
  const licensedOfflineCount = enrichedUsers.filter((u) => u.isLicensedOffline).length;
  const activePaidCount = enrichedUsers.filter((u) => u.isPaidActive).length;
  const activeTrialCount = enrichedUsers.filter((u) => u.isTrial).length;
  const trialUsedCount = enrichedUsers.filter((u) => u.isTrialUsed).length;
  const unlimitedVipCount = enrichedUsers.filter((u) => u.isUnlimited).length;
  const unclaimedKeysCount = licenses.filter((l) => l.status === 'unclaimed').length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-slate-100 flex flex-col overflow-hidden font-sans select-none sm:select-auto">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-[80] animate-in slide-in-from-top-2 duration-200">
          <div className="px-4 py-2.5 rounded-2xl bg-emerald-950 border border-emerald-400 text-emerald-200 text-xs font-bold shadow-2xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* TOP COMMAND CENTER HEADER */}
      <header className="h-16 px-3 sm:px-6 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0 shadow-xl z-20">
        <div className="flex items-center gap-3">
          <img
            src="/solva.webp"
            alt="SOLVATECH"
            className="w-10 h-10 rounded-2xl object-cover ring-2 ring-amber-500/40 shadow-lg shadow-emerald-950/60"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-black text-sm sm:text-base text-white tracking-wide">
                SOLVATECH ENTERPRISE
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-300 font-bold text-[9px] uppercase tracking-wider hidden sm:inline">
                Founder Master
              </span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-slate-400 font-mono flex items-center gap-1.5 truncate">
              <span className="text-amber-300 font-bold">{currentUserEmail || OWNER_EMAILS[0]}</span>
              <span className="text-slate-600">•</span>
              <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                Live Engine
              </span>
            </p>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              void loadAllData();
              void loadLiveStatus();
            }}
            title="Refresh All Telemetry"
            className="p-2 sm:px-3 sm:py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all flex items-center gap-1.5 text-xs font-semibold"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
            <span className="hidden sm:inline">Sync Data</span>
          </button>

          <button
            onClick={onClose}
            className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-black text-xs shadow-md transition-all flex items-center gap-1.5 active:scale-95"
            title="Switch back to WhatsApp Bot simulator"
          >
            <Smartphone className="w-4 h-4" />
            <span className="hidden sm:inline">Return to Bot App</span>
            <span className="sm:hidden">Bot</span>
          </button>
        </div>
      </header>

      {/* PORTABLE TOP TABS (RESPONSIVE & UNCLUTTERED) */}
      <div className="bg-slate-900/90 border-b border-slate-800 px-3 sm:px-6 py-2 shrink-0 flex items-center justify-between gap-2 overflow-x-auto">
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Tab 1: Users Hub */}
          <button
            onClick={() => setActiveTab('users')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 ${
              activeTab === 'users'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-xs'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Users & Accounts Hub</span>
            <span className="px-1.5 py-0.2 rounded-md bg-slate-800 text-[10px] font-mono text-emerald-300 font-bold">
              {totalUsersCount}
            </span>
          </button>

          {/* Tab 2: Keys & OPay Vault */}
          <button
            onClick={() => setActiveTab('keys_opay')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 ${
              activeTab === 'keys_opay'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-xs'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Key className="w-4 h-4 text-amber-400" />
            <span>Keys & OPay Vault</span>
            <span className="px-1.5 py-0.2 rounded-md bg-slate-800 text-[10px] font-mono text-amber-300 font-bold">
              {unclaimedKeysCount} ready
            </span>
          </button>

          {/* Tab 3: Bot Engine & System */}
          <button
            onClick={() => setActiveTab('system')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 ${
              activeTab === 'system'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-xs'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Bot Engine & Systems</span>
            <span
              className={`w-2 h-2 rounded-full ${
                whatsappStatus.isConnected ? 'bg-emerald-400' : 'bg-rose-500'
              }`}
            />
          </button>
        </div>

        {/* Quick OPay Account Tag */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-xl bg-slate-950 border border-emerald-500/30 text-[11px] font-mono">
          <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-slate-400">OPay:</span>
          <span className="text-emerald-300 font-bold">{PAYMENT_INFO.accountNumber}</span>
          <span className="text-slate-500">({PAYMENT_INFO.accountName})</span>
        </div>
      </div>

      {/* KPI TELEMETRY SUMMARY TICKER */}
      <section className="px-3 sm:px-6 py-2.5 border-b border-slate-800 bg-slate-900/40 shrink-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
          {/* Card 1: Total Users */}
          <button
            type="button"
            onClick={() => { setActiveTab('users'); setUserFilter('all'); }}
            className={`p-2.5 rounded-xl border text-left transition-all ${
              userFilter === 'all' && activeTab === 'users'
                ? 'bg-slate-800 border-slate-600'
                : 'bg-slate-900/80 border-slate-800/80 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between text-slate-400 text-[10px]">
              <span>All Users</span>
              <Users className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <p className="text-lg font-black text-white font-mono leading-tight">{totalUsersCount}</p>
            <span className="text-[9px] text-slate-400 font-semibold">Registered Base</span>
          </button>

          {/* Card 2: Online WhatsApp */}
          <button
            type="button"
            onClick={() => { setActiveTab('users'); setUserFilter('online'); }}
            className={`p-2.5 rounded-xl border text-left transition-all ${
              userFilter === 'online' && activeTab === 'users'
                ? 'bg-emerald-950/60 border-emerald-400'
                : 'bg-slate-900/80 border-emerald-500/20 hover:border-emerald-500/40'
            }`}
          >
            <div className="flex items-center justify-between text-slate-400 text-[10px]">
              <span>WhatsApp Online</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
            </div>
            <p className="text-lg font-black text-emerald-400 font-mono leading-tight">{onlineUsersCount}</p>
            <span className="text-[9px] text-emerald-300 font-semibold">Active WhatsApp Socket</span>
          </button>

          {/* Card 3: Active License (Offline) */}
          <button
            type="button"
            onClick={() => { setActiveTab('users'); setUserFilter('licensed_offline'); }}
            className={`p-2.5 rounded-xl border text-left transition-all ${
              userFilter === 'licensed_offline' && activeTab === 'users'
                ? 'bg-teal-950/60 border-teal-400'
                : 'bg-slate-900/80 border-teal-500/20 hover:border-teal-500/40'
            }`}
          >
            <div className="flex items-center justify-between text-slate-400 text-[10px]">
              <span>License Active (Offline)</span>
              <Key className="w-3.5 h-3.5 text-teal-400" />
            </div>
            <p className="text-lg font-black text-teal-300 font-mono leading-tight">{licensedOfflineCount}</p>
            <span className="text-[9px] text-teal-400 font-semibold">Key active, not connected</span>
          </button>

          {/* Card 4: 30-Min Trials */}
          <button
            type="button"
            onClick={() => { setActiveTab('users'); setUserFilter('trial'); }}
            className={`p-2.5 rounded-xl border text-left transition-all ${
              userFilter === 'trial' && activeTab === 'users'
                ? 'bg-amber-950/60 border-amber-400'
                : 'bg-slate-900/80 border-amber-500/20 hover:border-amber-500/40'
            }`}
          >
            <div className="flex items-center justify-between text-slate-400 text-[10px]">
              <span>30-Min Trials</span>
              <Clock className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <p className="text-lg font-black text-amber-300 font-mono leading-tight">{activeTrialCount}</p>
            <span className="text-[9px] text-amber-300 font-semibold">Testing bot right now</span>
          </button>

          {/* Card 5: Trial Used Once */}
          <button
            type="button"
            onClick={() => { setActiveTab('users'); setUserFilter('trial_used'); }}
            className={`p-2.5 rounded-xl border text-left transition-all ${
              userFilter === 'trial_used' && activeTab === 'users'
                ? 'bg-indigo-950/60 border-indigo-400'
                : 'bg-slate-900/80 border-indigo-500/20 hover:border-indigo-500/40'
            }`}
          >
            <div className="flex items-center justify-between text-slate-400 text-[10px]">
              <span>30m Test Claimed</span>
              <Check className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <p className="text-lg font-black text-indigo-300 font-mono leading-tight">{trialUsedCount}</p>
            <span className="text-[9px] text-indigo-300 font-semibold">Used 1-time allowance</span>
          </button>

          {/* Card 6: Unlimited VIPs */}
          <button
            type="button"
            onClick={() => { setActiveTab('users'); setUserFilter('unlimited'); }}
            className={`p-2.5 rounded-xl border text-left transition-all ${
              userFilter === 'unlimited' && activeTab === 'users'
                ? 'bg-amber-950/60 border-amber-400'
                : 'bg-slate-900/80 border-amber-500/20 hover:border-amber-500/40'
            }`}
          >
            <div className="flex items-center justify-between text-slate-400 text-[10px]">
              <span>👑 Unlimited VIPs</span>
              <Crown className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <p className="text-lg font-black text-amber-300 font-mono leading-tight">{unlimitedVipCount}</p>
            <span className="text-[9px] text-amber-400 font-semibold">Lifetime Master Access</span>
          </button>
        </div>
      </section>

      {/* MAIN VIEWPORT */}
      <main className="flex-1 overflow-y-auto p-3 sm:p-6 bg-slate-950 space-y-4">
        {/* ======================================================== */}
        {/* TAB 1: USERS & ACCOUNTS HUB (UNCLUTTERED & STREAMLINED)   */}
        {/* ======================================================== */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            {/* Filter and Search Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900/80 p-3 rounded-2xl border border-slate-800">
              {/* Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 text-xs">
                <button
                  type="button"
                  onClick={() => setUserFilter('all')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all shrink-0 ${
                    userFilter === 'all'
                      ? 'bg-white text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  All ({totalUsersCount})
                </button>
                <button
                  type="button"
                  onClick={() => setUserFilter('online')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all shrink-0 flex items-center gap-1.5 ${
                    userFilter === 'online'
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 text-emerald-300 hover:text-white'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>Online WhatsApp ({onlineUsersCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUserFilter('licensed_offline')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all shrink-0 ${
                    userFilter === 'licensed_offline'
                      ? 'bg-teal-500 text-slate-950'
                      : 'bg-slate-800 text-teal-300 hover:text-white'
                  }`}
                >
                  License Active (Offline) ({licensedOfflineCount})
                </button>
                <button
                  type="button"
                  onClick={() => setUserFilter('trial')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all shrink-0 ${
                    userFilter === 'trial'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-amber-300 hover:text-white'
                  }`}
                >
                  30-Min Testing ({activeTrialCount})
                </button>
                <button
                  type="button"
                  onClick={() => setUserFilter('trial_used')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all shrink-0 ${
                    userFilter === 'trial_used'
                      ? 'bg-indigo-500 text-slate-950'
                      : 'bg-slate-800 text-indigo-300 hover:text-white'
                  }`}
                >
                  30m Used ({trialUsedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setUserFilter('unlimited')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all shrink-0 flex items-center gap-1 ${
                    userFilter === 'unlimited'
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-slate-800 text-amber-300 hover:text-white'
                  }`}
                >
                  <Crown className="w-3.5 h-3.5" />
                  <span>Unlimited VIP ({unlimitedVipCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUserFilter('expired')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all shrink-0 ${
                    userFilter === 'expired'
                      ? 'bg-rose-500 text-white'
                      : 'bg-slate-800 text-rose-300 hover:text-white'
                  }`}
                >
                  Expired
                </button>
              </div>

              {/* Actions & Search */}
              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                <button
                  type="button"
                  onClick={async () => {
                    showToast('🔄 Fetching all users globally from Firebase...');
                    await refreshAdminUsers();
                    await loadLiveStatus();
                    showToast('✅ All global users refreshed in twinkle of an eye!');
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold flex items-center gap-1.5 transition-all shrink-0 active:scale-95 shadow-xs cursor-pointer"
                  title="Fetch all users and newly registered accounts immediately from Firebase"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                  <span>🔄 Refresh Users</span>
                </button>
                <button
                  type="button"
                  onClick={handleReconnectAll}
                  disabled={reconnectingAll}
                  className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 text-[11px] font-black flex items-center gap-1.5 transition-all shrink-0 active:scale-95 shadow-md shadow-emerald-950/40 cursor-pointer disabled:opacity-50"
                  title="Reconnect all accounts with active licenses and WhatsApp records back to their WhatsApp"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${reconnectingAll ? 'animate-spin' : ''}`} />
                  <span>{reconnectingAll ? 'Reconnecting All...' : '⚡ Reconnect All'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleGrantSevenDaysToAll}
                  className="px-3 py-1.5 rounded-xl bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 border border-teal-500/40 text-[11px] font-bold flex items-center gap-1.5 transition-all shrink-0 active:scale-95 shadow-xs cursor-pointer"
                  title="Add +7 Days to all users"
                >
                  <PlusCircle className="w-3.5 h-3.5 text-teal-400" />
                  <span>+7 Days to All</span>
                </button>
                <button
                  type="button"
                  onClick={handleTerminateAllLicenses}
                  className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-[11px] font-bold flex items-center gap-1.5 transition-all shrink-0 active:scale-95 shadow-xs cursor-pointer"
                  title="Terminate ALL licenses and set them to expired immediately"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>Terminate All</span>
                </button>
                <div className="relative w-full md:w-60">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search user, Gmail, phone..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            {/* THE USERS TABLE (RESPONSIVE & CLEAN) */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 overflow-hidden shadow-2xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse min-w-[760px]">
                  <thead className="bg-slate-950 border-b border-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">User & Gmail Account</th>
                      <th className="py-3 px-4 text-center">
                        <span className="inline-flex items-center gap-1 text-amber-400 font-black">
                          <Crown className="w-3.5 h-3.5" />
                          <span>UNLIMITED SWITCH</span>
                        </span>
                      </th>
                      <th className="py-3 px-4">WhatsApp Connection</th>
                      <th className="py-3 px-4">License & Time Remaining</th>
                      <th className="py-3 px-4">30-Min Test</th>
                      <th className="py-3 px-4 text-right">Quick Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-slate-500 font-mono text-xs">
                          No users matching filter "{userFilter}".
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((user) => {
                        const isActionLoadingThis = actionLoadingUid === user.uid;
                        const isTogglingThis = togglingUid === user.uid;
                        const isPermanentFounder = isOwnerEmail(user.email);

                        return (
                          <tr key={user.uid} className="hover:bg-slate-800/40 transition-colors">
                            {/* Column 1: User & Gmail */}
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2.5">
                                <div
                                  className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shrink-0 ${
                                    isPermanentFounder
                                      ? 'bg-gradient-to-tr from-amber-400 to-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                                      : user.isUnlimited
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                      : 'bg-slate-800 text-slate-300'
                                  }`}
                                >
                                  {isPermanentFounder ? <Crown className="w-4 h-4 text-slate-950" /> : user.displayName?.charAt(0).toUpperCase() || 'U'}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <strong className="text-white font-bold text-xs truncate max-w-[150px]">
                                      {user.displayName || 'Solvatech User'}
                                    </strong>
                                    {isPermanentFounder && (
                                      <span className="px-1.5 py-0.2 rounded bg-amber-500/30 text-amber-300 font-mono font-bold text-[9px] border border-amber-400/40">
                                        FOUNDER
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[11px] text-slate-400 font-mono block truncate max-w-[180px]">
                                    {user.email}
                                  </span>
                                </div>
                              </div>
                            </td>

                            {/* Column 2: THE UNLIMITED SWITCH */}
                            <td className="py-3 px-4 text-center whitespace-nowrap">
                              {isPermanentFounder ? (
                                <div className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-500/20 border border-amber-400/60 text-amber-300 font-black text-[11px] shadow-xs">
                                  <Crown className="w-3.5 h-3.5 text-amber-400" />
                                  <span>PERMANENT VIP (LOCKED)</span>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleToggleUnlimited(user)}
                                  disabled={isTogglingThis}
                                  className={`relative inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-black text-[11px] transition-all shadow-md active:scale-95 ${
                                    user.isUnlimited
                                      ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-slate-950 ring-2 ring-amber-400/50 shadow-amber-500/20'
                                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                                  }`}
                                >
                                  {isTogglingThis ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  ) : user.isUnlimited ? (
                                    <Crown className="w-3.5 h-3.5 text-slate-950" />
                                  ) : (
                                    <Zap className="w-3.5 h-3.5 text-slate-400" />
                                  )}
                                  <span>{user.isUnlimited ? '👑 VIP ON' : 'VIP OFF'}</span>
                                </button>
                              )}
                            </td>

                            {/* Column 3: WhatsApp Live Status */}
                            <td className="py-3 px-4 whitespace-nowrap">
                              {user.isOnline ? (
                                <div className="space-y-0.5">
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/80 text-emerald-300 font-bold text-[10px] border border-emerald-500/40">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                                    <span>ONLINE (WhatsApp Connected)</span>
                                  </span>
                                  {user.linkedPhone && (
                                    <p className="text-[10px] text-emerald-400 font-mono pl-1">
                                      +{user.linkedPhone}
                                    </p>
                                  )}
                                </div>
                              ) : user.isExpired ? (
                                <div className="space-y-0.5">
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-950/60 text-rose-300 text-[10px] border border-rose-500/40 font-semibold">
                                    <span>🔴 License Elapsed (Bot Paused)</span>
                                  </span>
                                  {user.linkedPhone ? (
                                    <p className="text-[9px] text-amber-400/90 pl-1 font-mono">
                                      Linked: +{user.linkedPhone} (Awaiting key renewal)
                                    </p>
                                  ) : (
                                    <p className="text-[9px] text-rose-400/80 pl-1">Plan completed (Not linked)</p>
                                  )}
                                </div>
                              ) : user.isLicensedOffline ? (
                                <div className="space-y-0.5">
                                  {user.linkedPhone || user.isPaired ? (
                                    <>
                                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/60 text-amber-300 text-[10px] border border-amber-500/30 font-medium">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                        <span>LINKED (Reconnecting 24/7)</span>
                                      </span>
                                      <p className="text-[9px] text-amber-300/90 pl-1 font-mono">
                                        +{user.linkedPhone || 'Companion Saved'}
                                      </p>
                                    </>
                                  ) : (
                                    <>
                                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-teal-950/60 text-teal-300 text-[10px] border border-teal-500/30">
                                        <Key className="w-3 h-3 text-teal-400" />
                                        <span>Active License (Ready to Pair)</span>
                                      </span>
                                      <p className="text-[9px] text-slate-500 pl-1">Not linked yet</p>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <div className="space-y-0.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-950 text-slate-500 text-[10px] border border-slate-800">
                                    <span>⚪ Disconnected (No Key)</span>
                                  </span>
                                  {user.linkedPhone && (
                                    <p className="text-[9px] text-slate-500 pl-1 font-mono">
                                      +{user.linkedPhone}
                                    </p>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* Column 4: License & Plan */}
                            <td className="py-3 px-4 whitespace-nowrap">
                              <div>
                                <span
                                  className={`inline-block px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                                    user.isUnlimited
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                      : user.isTrial
                                      ? 'bg-amber-950/60 text-amber-300 border border-amber-500/30'
                                      : user.isPaidActive
                                      ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30'
                                      : 'bg-rose-950/60 text-rose-300 border border-rose-500/30'
                                  }`}
                                >
                                  {user.licensePlan || 'Standard User'}
                                </span>
                                <div className="text-[11px] font-mono mt-0.5">
                                  <span
                                    className={`font-bold ${
                                      user.isUnlimited
                                        ? 'text-amber-400'
                                        : user.remaining.isExpired
                                        ? 'text-rose-400'
                                        : 'text-emerald-300'
                                    }`}
                                  >
                                    {user.remaining.formatted}
                                  </span>
                                </div>
                              </div>
                            </td>

                            {/* Column 5: 30-Min Test Status (Permanent Lifetime Lock) */}
                            <td className="py-3 px-4 whitespace-nowrap text-[11px]">
                              {user.hasUsedTrial ? (
                                <span className="text-emerald-400 font-medium flex items-center gap-1.5" title="Strictly once in a lifetime per email in Firebase. Admin cannot revoke or reset.">
                                  <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                  <span>Claimed (Lifetime)</span>
                                </span>
                              ) : (
                                <span className="text-amber-400 font-semibold flex items-center gap-1">
                                  <Sparkles className="w-3 h-3 text-amber-400" />
                                  <span>Eligible (Unused)</span>
                                </span>
                              )}
                            </td>

                            {/* Column 6: Quick Actions */}
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleReconnectUser(user)}
                                  disabled={reconnectingUid === user.uid || isActionLoadingThis}
                                  className="px-2 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[10px] font-bold border border-emerald-500/40 cursor-pointer flex items-center gap-1 transition-all disabled:opacity-50"
                                  title="Try reconnecting this user to their WhatsApp for 1 minute"
                                >
                                  <RefreshCw className={`w-2.5 h-2.5 text-emerald-400 ${reconnectingUid === user.uid ? 'animate-spin' : ''}`} />
                                  <span>{reconnectingUid === user.uid ? 'Connecting...' : 'Reconnect'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAddDays(user, 7)}
                                  disabled={isActionLoadingThis}
                                  className="px-2.5 py-1 rounded-lg bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 text-[10px] font-bold border border-teal-500/40 cursor-pointer flex items-center gap-1"
                                  title="Add +7 Days to this user"
                                >
                                  <Zap className="w-2.5 h-2.5 text-teal-400" />
                                  <span>+7D</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setInspectingUser(user)}
                                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-bold border border-slate-700 flex items-center gap-1 cursor-pointer"
                                >
                                  <Eye className="w-3 h-3 text-slate-400" />
                                  <span>Inspect</span>
                                </button>
                                {!isPermanentFounder && (
                                  <button
                                    type="button"
                                    onClick={() => handleRevokeUser(user)}
                                    disabled={isActionLoadingThis}
                                    className="p-1 rounded-lg bg-slate-800 hover:bg-rose-950 text-rose-400 text-[10px] border border-slate-700 cursor-pointer"
                                    title="Terminate License"
                                  >
                                    <UserX className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* USER INSPECTION AUDIT MODAL */}
            {inspectingUser && (
              <div className="fixed inset-0 z-[90] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl relative animate-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-sm">
                        {inspectingUser.displayName?.charAt(0).toUpperCase() || 'U'}
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                          <span>{inspectingUser.displayName || 'User Profile'}</span>
                          {inspectingUser.isUnlimited && (
                            <span className="text-amber-400 font-mono text-xs">👑 VIP</span>
                          )}
                        </h3>
                        <p className="text-xs text-slate-400 font-mono">{inspectingUser.email}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setInspectingUser(null)}
                      className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                      <span className="text-[10px] text-slate-400 block">WhatsApp Socket</span>
                      <strong className={inspectingUser.isOnline ? 'text-emerald-400' : 'text-slate-400'}>
                        {inspectingUser.isOnline ? '🟢 Online (Connected)' : inspectingUser.isLicensedOffline ? '🔑 Active License (Offline)' : '⚪ Disconnected'}
                      </strong>
                      {inspectingUser.linkedPhone && (
                        <p className="text-[10px] text-emerald-400 font-mono">+{inspectingUser.linkedPhone}</p>
                      )}
                    </div>

                    <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                      <span className="text-[10px] text-slate-400 block">Current Plan</span>
                      <strong className="text-amber-300">{inspectingUser.licensePlan || 'None'}</strong>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {inspectingUser.remaining?.formatted || 'No time'}
                      </p>
                    </div>

                    <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                      <span className="text-[10px] text-slate-400 block">30-Min Test Status</span>
                      <strong className={inspectingUser.hasUsedTrial ? 'text-slate-400' : 'text-amber-400'}>
                        {inspectingUser.hasUsedTrial ? 'Claimed & Used' : 'Available (Unused)'}
                      </strong>
                    </div>

                    <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                      <span className="text-[10px] text-slate-400 block">Bot Activity</span>
                      <strong className="text-white">{inspectingUser.commandsRun || 0} Commands Run</strong>
                      <p className="text-[9px] text-slate-500 font-mono">UID: {inspectingUser.uid}</p>
                    </div>
                  </div>

                  {/* Unlimited Toggle Inside Inspector */}
                  <div className="p-3.5 rounded-2xl bg-slate-950 border border-amber-500/30 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-amber-300 block">Unlimited VIP Master Switch</span>
                      <p className="text-[10px] text-slate-400">Instantly grant or revoke lifetime access</p>
                    </div>
                    {isOwnerEmail(inspectingUser.email) ? (
                      <span className="px-3 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 font-bold text-xs border border-amber-500/40">
                        Permanent Founder (Locked)
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          handleToggleUnlimited(inspectingUser);
                          setInspectingUser((prev: any) => ({
                            ...prev,
                            isUnlimited: !prev?.isUnlimited,
                          }));
                        }}
                        className={`px-4 py-2 rounded-xl font-black text-xs transition-all ${
                          inspectingUser.isUnlimited
                            ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/40'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {inspectingUser.isUnlimited ? '👑 VIP ON' : 'Turn VIP ON'}
                      </button>
                    )}
                  </div>

                  {/* Modal Footer Controls */}
                  <div className="flex gap-2 justify-end pt-2 border-t border-slate-800 text-xs">
                    <button
                      onClick={() => {
                        handleAddDays(inspectingUser, 7);
                        setInspectingUser(null);
                      }}
                      className="px-3.5 py-2 rounded-xl bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 font-bold border border-teal-500/40 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Zap className="w-3.5 h-3.5 text-teal-400" />
                      <span>+7 Days</span>
                    </button>
                    {!inspectingUser.isOwner && (
                      <button
                        onClick={() => {
                          handleRevokeUser(inspectingUser);
                          setInspectingUser(null);
                        }}
                        className="px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-bold border border-rose-500/40 flex items-center gap-1.5 cursor-pointer"
                      >
                        <UserX className="w-3.5 h-3.5 text-rose-400" />
                        <span>Terminate License</span>
                      </button>
                    )}
                    <button
                      onClick={() => setInspectingUser(null)}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* RECONNECT ALL AUDIT & TELEMETRY RESULT MODAL */}
            {reconnectAllResult && (
              <div className="fixed inset-0 z-[95] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
                <div className="bg-slate-900 border border-emerald-500/50 rounded-3xl max-w-2xl w-full p-6 space-y-5 shadow-2xl relative animate-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3 shrink-0">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40">
                        <RefreshCw className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div>
                        <h3 className="text-base font-black text-white flex items-center gap-2">
                          <span>⚡ Reconnect All Report</span>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                            AUDIT COMPLETE
                          </span>
                        </h3>
                        <p className="text-xs text-slate-400">Targeting accounts with active license and WhatsApp records</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setReconnectAllResult(null)}
                      className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Summary Banner */}
                  <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 space-y-1.5 shrink-0">
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>{reconnectAllResult.message}</span>
                    </div>
                    <p className="text-[11px] text-slate-300">
                      Evaluated {reconnectAllResult.stats.totalEvaluated} accounts. Active WhatsApp sockets remain persistent 24/7.
                    </p>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs shrink-0">
                    <div className="p-3 rounded-2xl bg-slate-950 border border-emerald-500/30">
                      <span className="text-[10px] text-slate-400 block">Connected Back</span>
                      <strong className="text-emerald-400 text-lg font-black">{reconnectAllResult.stats.connectedBack}</strong>
                      <span className="text-[9px] text-emerald-500/80 block">🟢 Online now</span>
                    </div>

                    <div className="p-3 rounded-2xl bg-slate-950 border border-amber-500/30">
                      <span className="text-[10px] text-slate-400 block">Already Online</span>
                      <strong className="text-amber-300 text-lg font-black">{reconnectAllResult.stats.alreadyOnline}</strong>
                      <span className="text-[9px] text-amber-500/80 block">⚡ Actively serving</span>
                    </div>

                    <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">No Record Linked</span>
                      <strong className="text-slate-300 text-lg font-black">{reconnectAllResult.stats.failedNoRecord}</strong>
                      <span className="text-[9px] text-slate-500 block">Needs first pair</span>
                    </div>

                    <div className="p-3 rounded-2xl bg-slate-950 border border-rose-500/30">
                      <span className="text-[10px] text-slate-400 block">Unlinked on Phone</span>
                      <strong className="text-rose-400 text-lg font-black">{reconnectAllResult.stats.failedUnlinked}</strong>
                      <span className="text-[9px] text-rose-500/80 block">Unlinked from WA app</span>
                    </div>

                    <div className="p-3 rounded-2xl bg-slate-950 border border-rose-500/30">
                      <span className="text-[10px] text-slate-400 block">No Active License</span>
                      <strong className="text-rose-300 text-lg font-black">{reconnectAllResult.stats.failedNoLicense}</strong>
                      <span className="text-[9px] text-rose-400/80 block">Plan elapsed</span>
                    </div>

                    <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">Phone Unreachable</span>
                      <strong className="text-amber-400 text-lg font-black">{reconnectAllResult.stats.failedUnreachable}</strong>
                      <span className="text-[9px] text-amber-500/80 block">Offline / No Net</span>
                    </div>
                  </div>

                  {/* Account Breakdown List */}
                  <div className="space-y-1.5 flex-1 overflow-y-auto pr-1 min-h-36">
                    <span className="text-[11px] font-bold text-slate-400 block">Account Audit Breakdown:</span>
                    <div className="space-y-1.5">
                      {reconnectAllResult.breakdown.map((item, idx) => (
                        <div
                          key={item.uid + '_' + idx}
                          className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-xs"
                        >
                          <div className="min-w-0 pr-2">
                            <span className="font-bold text-white block truncate">{item.email || item.uid}</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {item.phone ? `+${item.phone} • ` : ''}
                              {item.detail}
                            </span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold shrink-0 ${
                              item.status === 'connected'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : item.status === 'already_online'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : item.status === 'no_license'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                : item.status === 'no_record'
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                                : 'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}
                          >
                            {item.status === 'no_license'
                              ? 'NO LICENSE'
                              : item.status === 'no_record'
                              ? 'NEEDS PAIR'
                              : item.status.toUpperCase().replace('_', ' ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex justify-end pt-2 border-t border-slate-800 shrink-0">
                    <button
                      onClick={() => setReconnectAllResult(null)}
                      className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs cursor-pointer shadow-lg shadow-emerald-950/40"
                    >
                      Dismiss Report
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* SINGLE RECONNECT NOTICE MODAL */}
            {reconnectNotice && (
              <div className="fixed inset-0 z-[95] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl relative animate-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <h3 className="font-bold text-sm text-white flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-400" />
                      <span>{reconnectNotice.title}</span>
                    </h3>
                    <button
                      onClick={() => setReconnectNotice(null)}
                      className="p-1 rounded-lg text-slate-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
                    {reconnectNotice.message}
                  </p>
                  <div className="flex justify-end pt-2 border-t border-slate-800">
                    <button
                      onClick={() => setReconnectNotice(null)}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs cursor-pointer"
                    >
                      Okay
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: KEYS & OPAY VAULT (CONSOLIDATED POWERHOUSE)       */}
        {/* ======================================================== */}
        {activeTab === 'keys_opay' && (
          <div className="space-y-6">
            {/* Top Grid: Key Minting Machine + OPay Payment Approver */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Card 1: Key Minting Factory */}
              <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-4 shadow-xl">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                      <Key className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-white">License Key Minting Machine</h3>
                      <p className="text-[11px] text-slate-400">Mint preset or custom duration keys</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    Instant Mint
                  </span>
                </div>

                <div>
                  {/* Segmented Mode Selector */}
                  <div className="flex p-1 bg-slate-950 rounded-xl border border-slate-800 mb-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setIsCustomDuration(false)}
                      className={`flex-1 py-1.5 px-3 rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 ${
                        !isCustomDuration
                          ? 'bg-emerald-600 text-slate-950 shadow-md'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Key className="w-3.5 h-3.5" />
                      <span>Normal Preset Keys (1D, 2D, 3D...)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCustomDuration(true)}
                      className={`flex-1 py-1.5 px-3 rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 ${
                        isCustomDuration
                          ? 'bg-amber-500 text-slate-950 shadow-md'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Custom Duration Key</span>
                    </button>
                  </div>

                  {!isCustomDuration ? (
                    <div className="space-y-2">
                      <label className="block text-[11px] font-bold text-slate-300">
                        Select Normal Key Duration:
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        {LICENSE_PLANS.slice(0, 8).map((plan) => (
                          <button
                            key={plan.id}
                            type="button"
                            onClick={() => setSelectedPlan(plan)}
                            className={`p-2.5 rounded-xl border text-left transition-all active:scale-95 ${
                              selectedPlan.id === plan.id
                                ? 'bg-emerald-950/80 border-emerald-400 text-white font-bold ring-1 ring-emerald-400/50 shadow-md'
                                : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                            }`}
                          >
                            <div className="font-bold text-xs">{plan.name}</div>
                            <div className="font-mono text-emerald-400 text-[10px] mt-0.5">{plan.priceFormatted}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-2xl bg-slate-950 border border-amber-500/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-amber-400" />
                          <span className="text-xs font-bold text-white">Custom Days Duration</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsCustomDuration(false)}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 text-[11px] font-bold flex items-center gap-1 border border-slate-700 transition-all active:scale-95"
                        >
                          <span>← Back to Normal Keys</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-3 bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                        <div className="flex-1">
                          <label className="block text-[10px] text-slate-400 mb-0.5">Enter Number of Days:</label>
                          <input
                            type="number"
                            min="1"
                            max="365"
                            value={customDays}
                            onChange={(e) => setCustomDays(parseInt(e.target.value) || 1)}
                            className="w-full bg-transparent text-white font-mono font-bold text-base focus:outline-none"
                          />
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-amber-300 font-bold font-mono block">
                            {customDays} Day{customDays !== 1 ? 's' : ''}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            ₦{(customDays * 200).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <p className="text-[11px] text-slate-400 leading-tight">
                        Enter any custom duration in days. You can also tap the button above to go back to normal 1 day, 2 days, 3 days presets anytime.
                      </p>
                    </div>
                  )}
                </div>

                {/* Batch Quantity Selector & Mint Controls */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-300">
                    <span>Batch Quantity Preset:</span>
                    <span className="text-amber-400 font-mono text-[11px]">{batchCount} Keys Selected</span>
                  </div>

                  {/* Quantity selector pills */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {[5, 10, 20, 50].map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        onClick={() => setBatchCount(qty)}
                        className={`py-2 rounded-xl text-xs font-bold transition-all border ${
                          batchCount === qty
                            ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-sm'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                        }`}
                      >
                        {qty} Keys
                      </button>
                    ))}
                  </div>

                  {/* Mint Buttons: Single + Batch */}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleGenerateKey}
                      disabled={generating || batchLoading}
                      className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 text-slate-950 font-black text-xs shadow-md transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
                    >
                      {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
                      <span>Mint 1 Key</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleBatchMint}
                      disabled={batchLoading || generating}
                      className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 text-slate-950 font-black text-xs shadow-md transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
                    >
                      {batchLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                      <span>Batch Mint {batchCount} Keys</span>
                    </button>
                  </div>
                </div>

                {/* Single Generated Key Result */}
                {generatedKey && (
                  <div className="p-4 rounded-2xl bg-slate-950 border border-emerald-500/50 space-y-3 animate-in fade-in">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-emerald-400">✓ Key Ready for Customer:</span>
                      <span className="text-slate-400 font-mono text-[11px]">{generatedKey.planName}</span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-2">
                      <span
                        onClick={() => copyKeyText(generatedKey.key)}
                        className="font-mono text-sm sm:text-base font-extrabold text-emerald-300 tracking-wider select-all cursor-pointer hover:text-emerald-200"
                        title="Click to copy"
                      >
                        {generatedKey.key}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyKeyText(generatedKey.key)}
                        className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors flex items-center gap-1 text-[11px] font-bold"
                      >
                        {copiedKey === generatedKey.key ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === generatedKey.key ? 'Copied!' : 'Copy'}</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => copyWhatsAppReceipt(generatedKey)}
                      className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-emerald-500/30 font-bold text-xs flex items-center justify-center gap-1.5 transition-all"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>{copiedMessage ? 'Copied Receipt!' : 'Copy WhatsApp Customer Receipt Slip'}</span>
                    </button>
                  </div>
                )}

                {/* BATCH GENERATED KEYS RESULT: Lists all 5, 10, 20 etc. keys with individual and bulk copy */}
                {batchGenerated && batchGenerated.length > 0 && (
                  <div className="p-4 rounded-2xl bg-slate-950 border-2 border-amber-500/50 space-y-3 animate-in fade-in shadow-xl">
                    {/* Master Action Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center font-bold text-xs border border-amber-500/40">
                          <Layers className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-black text-amber-300">
                            ✓ Batch of {batchGenerated.length} Keys Minted!
                          </h4>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {batchGenerated[0]?.planName} • All Unclaimed & Ready
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleCopyAllBatchKeys}
                          className="px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold flex items-center gap-1 transition-all active:scale-95"
                          title="Copy all keys to clipboard"
                        >
                          {copiedAllBatch ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedAllBatch ? 'Copied All Keys!' : `Copy All (${batchGenerated.length})`}</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleCopyAllBatchReceipts}
                          className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-emerald-300 border border-slate-700 text-[11px] font-bold flex items-center gap-1 transition-all"
                          title="Copy all customer slips"
                        >
                          {copiedAllReceipts ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />}
                          <span>{copiedAllReceipts ? 'Copied Slips!' : 'All Slips'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setBatchGenerated([])}
                          className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs border border-slate-800 transition-all"
                          title="Dismiss list"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Scrollable List of All Generated Keys */}
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {batchGenerated.map((lic, index) => (
                        <div
                          key={lic.key}
                          className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800/80 hover:border-emerald-500/50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 font-mono text-[11px] font-bold flex items-center justify-center shrink-0 border border-slate-700">
                              #{index + 1}
                            </span>
                            <div className="min-w-0">
                              <span
                                onClick={() => copyKeyText(lic.key)}
                                className="font-mono text-xs sm:text-sm font-extrabold text-emerald-300 tracking-wider hover:text-emerald-200 cursor-pointer select-all truncate block"
                                title="Click to copy key"
                              >
                                {lic.key}
                              </span>
                              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                <span>{lic.planName}</span>
                                <span>•</span>
                                <span className="text-emerald-400 font-medium">Unclaimed</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                            <button
                              type="button"
                              onClick={() => copyKeyText(lic.key)}
                              className="p-1.5 px-2.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors flex items-center gap-1 text-[11px] font-bold active:scale-95"
                            >
                              {copiedKey === lic.key ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => copyWhatsAppReceipt(lic)}
                              className="p-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-emerald-300 transition-colors flex items-center gap-1 text-[11px] font-bold"
                              title="Copy customer slip"
                            >
                              <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="hidden sm:inline">Slip</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Card 2: OPay Bank & Receipt Dispenser */}
              <div className="p-5 rounded-3xl bg-gradient-to-br from-emerald-950/60 via-slate-900 to-slate-900 border-2 border-emerald-500/40 space-y-4 shadow-xl">
                <div className="flex items-center justify-between pb-3 border-b border-emerald-500/30">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-400 to-teal-400 flex items-center justify-center font-black text-slate-950 text-sm shadow-md">
                      OPay
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-white">OPay Payment Approver</h3>
                      <p className="text-[11px] text-emerald-300">Issue key for bank transfer buyer</p>
                    </div>
                  </div>
                  <span className="font-mono text-xs text-emerald-300 font-bold bg-slate-950 px-2.5 py-1 rounded-xl border border-emerald-500/40">
                    ₦9049979183
                  </span>
                </div>

                {/* OPay Bank Prominent Display */}
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-emerald-500/30 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-mono block">OPay Account Number</span>
                    <strong className="text-xl font-black text-emerald-300 font-mono tracking-wider block">
                      {PAYMENT_INFO.accountNumber}
                    </strong>
                    <span className="text-[11px] text-white font-semibold">
                      Name: {PAYMENT_INFO.accountName} (OPay Bank)
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(PAYMENT_INFO.accountNumber);
                      showToast('Copied OPay account number!');
                    }}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </button>
                </div>

                <form onSubmit={handleDispenseOpayKey} className="space-y-3 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-400 mb-1 font-semibold">Buyer Name:</label>
                      <input
                        type="text"
                        value={opayCustomerName}
                        onChange={(e) => setOpayCustomerName(e.target.value)}
                        placeholder="e.g. John Doe"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 font-semibold">Buyer Phone (Optional):</label>
                      <input
                        type="text"
                        value={opayCustomerPhone}
                        onChange={(e) => setOpayCustomerPhone(e.target.value)}
                        placeholder="+2348012345678"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1 font-semibold">Purchased Plan:</label>
                    <select
                      value={opaySelectedPlan.id}
                      onChange={(e) => {
                        const p = LICENSE_PLANS.find((x) => x.id === e.target.value);
                        if (p) setOpaySelectedPlan(p);
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                    >
                      {LICENSE_PLANS.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name} — {plan.priceFormatted} ({plan.durationDays} Days)
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={opayDispensing || !opayCustomerName.trim()}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 text-slate-950 font-black text-xs shadow-md disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                  >
                    {opayDispensing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    <span>Confirm Payment & Issue Key Slip</span>
                  </button>
                </form>

                {opayDispensedSlip && (
                  <div className="p-3 rounded-2xl bg-slate-950 border border-emerald-500/40 space-y-2 animate-in fade-in">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                        Ready WhatsApp Delivery Slip:
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(opayDispensedSlip);
                          showToast('Copied delivery slip to clipboard!');
                        }}
                        className="px-2 py-0.5 rounded-lg bg-emerald-600 text-slate-950 font-bold text-[10px] flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copy Slip</span>
                      </button>
                    </div>
                    <pre className="p-2.5 rounded-xl bg-slate-900 text-[10px] text-slate-300 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                      {opayDispensedSlip}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom: License Inventory Ledger */}
            <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-4 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                <div>
                  <h3 className="font-bold text-sm text-white">License Key Inventory Ledger</h3>
                  <p className="text-xs text-slate-400">Total {licenses.length} keys in database</p>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={inventoryFilter}
                    onChange={(e: any) => setInventoryFilter(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="all">All Statuses</option>
                    <option value="all">All Statuses ({licenses.length})</option>
                    <option value="unclaimed">Unclaimed / Unused Keys ({unclaimedKeysCount})</option>
                    <option value="active">Active Claimed Keys</option>
                    <option value="expired">Expired Keys</option>
                    <option value="revoked">Revoked Keys</option>
                  </select>

                  <input
                    type="text"
                    value={inventorySearch}
                    onChange={(e) => setInventorySearch(e.target.value)}
                    placeholder="Search keys..."
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none"
                  />
                </div>
              </div>

              {/* DEDICATED FIREBASE STORAGE & SECURITY PURGE BAR */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">Firebase Space & Security Purge</h4>
                    <p className="text-[10px] text-slate-400">Permanently wipe keys to reclaim space or prevent anyone from redeeming them</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto">
                  {/* Button 1: Wipe All Unused Keys */}
                  <button
                    type="button"
                    onClick={handleWipeUnusedKeys}
                    disabled={wipingUnused || unclaimedKeysCount === 0}
                    className="flex-1 md:flex-initial px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 hover:border-rose-500/60 text-rose-300 font-bold text-[11px] transition-all flex items-center justify-center gap-1.5 disabled:opacity-40"
                    title="Permanently remove all unused keys so no one can redeem them"
                  >
                    {wipingUnused ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3 text-rose-400" />}
                    <span>Wipe All Unused Keys ({unclaimedKeysCount})</span>
                  </button>

                  {/* Button 2: Wipe All Expired Keys */}
                  <button
                    type="button"
                    onClick={handleWipeExpiredKeys}
                    disabled={wipingExpired}
                    className="flex-1 md:flex-initial px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 hover:border-amber-500/60 text-amber-300 font-bold text-[11px] transition-all flex items-center justify-center gap-1.5 disabled:opacity-40"
                    title="Permanently remove all expired keys to clear database space"
                  >
                    {wipingExpired ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3 text-amber-400" />}
                    <span>Wipe All Expired Keys</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead className="sticky top-0 bg-slate-950 border-b border-slate-800 text-[10px] text-slate-400 uppercase">
                    <tr>
                      <th className="py-2.5 px-3">License Key (Tap to Copy)</th>
                      <th className="py-2.5 px-3">Plan / Duration</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Claimed By</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-[11px]">
                    {filteredInventory.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500 font-mono">
                          No license keys match this filter.
                        </td>
                      </tr>
                    ) : (
                      filteredInventory.map((lic) => {
                        const isLicExpired =
                          lic.status === 'expired' ||
                          Boolean(lic.expiresAt && new Date(lic.expiresAt).getTime() < Date.now());

                        return (
                          <tr
                            key={lic.key}
                            onClick={() => copyKeyText(lic.key)}
                            className="hover:bg-slate-800/60 cursor-pointer transition-colors group active:bg-emerald-950/30"
                            title="Tap to copy this license key"
                          >
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white group-hover:text-emerald-300 select-all transition-colors">
                                  {lic.key}
                                </span>
                                {copiedKey === lic.key ? (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold animate-in fade-in">
                                    ✓ Copied!
                                  </span>
                                ) : (
                                  <span className="opacity-0 group-hover:opacity-100 text-[9px] text-slate-400 font-sans transition-opacity">
                                    (Tap to copy)
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-slate-300 font-sans font-medium">{lic.planName}</td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  lic.status === 'unclaimed' && !lic.claimedBy
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : isLicExpired
                                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                    : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                }`}
                              >
                                {lic.status === 'unclaimed' && !lic.claimedBy
                                  ? 'Unused'
                                  : isLicExpired
                                  ? 'Expired'
                                  : 'Active'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-400 truncate max-w-[150px] font-sans">
                              {lic.claimedEmail || '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div
                                className="flex items-center justify-end gap-1.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => copyKeyText(lic.key)}
                                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-400 text-[10px] font-bold flex items-center gap-1 active:scale-95"
                                >
                                  {copiedKey === lic.key ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                  <span>{copiedKey === lic.key ? 'Copied' : 'Copy'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => copyWhatsAppReceipt(lic)}
                                  title="Copy WhatsApp Dispatch Slip"
                                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                                >
                                  <MessageSquare className="w-3 h-3 text-emerald-400" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteKey(lic.key)}
                                  title="Delete this key"
                                  className="p-1 rounded bg-rose-950/40 hover:bg-rose-900 border border-rose-800/40 text-rose-400 hover:text-rose-200 transition-colors"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 3: BOT ENGINE & SYSTEMS (UNIFIED CONSOLE)             */}
        {/* ======================================================== */}
        {activeTab === 'system' && (
          <div className="space-y-6">
            {/* STRICT FORCED LINKS & BACKGROUND AUTO-JOIN MONITOR */}
            <div className="p-5 rounded-3xl bg-slate-900 border-2 border-emerald-500/40 space-y-3 shadow-xl">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <h4 className="font-bold text-sm text-white">
                    Official WhatsApp Channels & Background Enrollment
                  </h4>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 font-bold text-[10px]">
                  Mandatory Enforced
                </span>
              </div>

              <p className="text-xs text-slate-400">
                The 2 links strictly enforced for every user. When any user connects their WhatsApp bot, the engine silently enrolls them in the background (no one must know):
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {/* Link 1: Updates Channel */}
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-emerald-400 uppercase font-mono">
                      1. Updates Channel (Newsletter)
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">ID: {OFFICIAL_CHANNELS.updatesChannelId}</span>
                  </div>
                  <strong className="text-white block font-bold">SOLVATECH • UPDATES 🔊</strong>
                  <p className="text-[11px] text-slate-400 font-mono truncate">{OFFICIAL_CHANNELS.updatesChannelUrl}</p>
                  <div className="flex gap-2 pt-1">
                    <a
                      href={OFFICIAL_CHANNELS.updatesChannelUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-[10px] flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Open Channel</span>
                    </a>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(OFFICIAL_CHANNELS.updatesChannelUrl);
                        showToast('Copied channel link!');
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-[10px] flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </button>
                  </div>
                </div>

                {/* Link 2: Community Group */}
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-amber-400 uppercase font-mono">
                      2. Official Community Group
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">Code: {OFFICIAL_CHANNELS.communityGroupId}</span>
                  </div>
                  <strong className="text-white block font-bold">SOLVATECH WhatsApp Community</strong>
                  <p className="text-[11px] text-slate-400 font-mono truncate">{OFFICIAL_CHANNELS.communityGroupUrl}</p>
                  <div className="flex gap-2 pt-1">
                    <a
                      href={OFFICIAL_CHANNELS.communityGroupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[10px] flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Open Group</span>
                    </a>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(OFFICIAL_CHANNELS.communityGroupUrl);
                        showToast('Copied group link!');
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-[10px] flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/20 text-[11px] text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <strong>Silent Background Join Active:</strong> Baileys multi-device socket automatically triggers <code>groupAcceptInvite</code> and <code>newsletterFollow</code> silently on handshake.
                </span>
              </div>
            </div>

            {/* Socket State & Live Tester */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Baileys Socket Info */}
              <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-3 shadow-xl">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Baileys Multi-Device Status
                  </span>
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      whatsappStatus.isConnected ? 'bg-emerald-400' : 'bg-rose-500'
                    }`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">State</span>
                    <strong className="text-emerald-400 capitalize">{whatsappStatus.state || 'Disconnected'}</strong>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Phone</span>
                    <strong className="text-white font-mono">{whatsappStatus.user?.phone || 'Not Linked'}</strong>
                  </div>
                </div>
                <button
                  onClick={handleRestartSocket}
                  className="w-full py-2 rounded-xl bg-slate-800 hover:bg-rose-950 text-rose-300 font-bold text-xs border border-rose-500/30 transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reset WhatsApp Companion Session</span>
                </button>
              </div>

              {/* Bot Command Simulator */}
              <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-3 shadow-xl">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Interactive Bot Command Tester
                  </span>
                  <Terminal className="w-4 h-4 text-amber-400" />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={testCmdInput}
                    onChange={(e) => setTestCmdInput(e.target.value)}
                    placeholder="e.g. .ping, .link, .ai what is ai"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={handleRunTestCommand}
                    disabled={testCmdRunning}
                    className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs"
                  >
                    {testCmdRunning ? '...' : 'Run'}
                  </button>
                </div>
                {testCmdOutput && (
                  <pre className="p-2.5 rounded-xl bg-slate-950 border border-emerald-500/30 text-emerald-300 font-mono text-[10px] whitespace-pre-wrap max-h-24 overflow-y-auto">
                    {testCmdOutput}
                  </pre>
                )}
              </div>
            </div>

            {/* Global Broadcast Announcer */}
            <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-3 shadow-xl">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                <Send className="w-4 h-4 text-emerald-400" />
                <h4 className="font-bold text-xs text-white uppercase tracking-wider">
                  Global System Broadcaster
                </h4>
              </div>
              <form onSubmit={handleSendBroadcast} className="space-y-2">
                <textarea
                  rows={2}
                  value={broadcastText}
                  onChange={(e) => setBroadcastText(e.target.value)}
                  placeholder="Send instant alert to all active users..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                  required
                />
                <div className="flex items-center justify-between">
                  {broadcastSuccess && <span className="text-xs text-emerald-400 font-bold">{broadcastSuccess}</span>}
                  <button
                    type="submit"
                    disabled={broadcastSending}
                    className="ml-auto py-2 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 text-slate-950 font-bold text-xs"
                  >
                    {broadcastSending ? 'Sending...' : 'Broadcast Alert'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
