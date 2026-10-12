import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Shield,
  Users,
  Check,
  Copy,
  RefreshCw,
  Zap,
  Sparkles,
  Sliders,
  AlertTriangle,
  CheckCircle2,
  Crown,
  Search,
  ExternalLink,
  Flame,
  Radio,
  Lock,
  ArrowRight,
  Info,
  Smartphone,
  QrCode,
  Image as ImageIcon,
} from 'lucide-react';
import { safeParseJson } from '../App';
import { WhatsAppNotification } from './NotificationsPanel';

export interface GroupSecuritySettings {
  autowelcome: boolean;
  autogoodbye: boolean;
  antilink: boolean;
  antibot: boolean;
  antistatus: boolean;
  antispam: boolean;
  warnLimit?: number;
}

export interface GroupItem {
  id: string;
  subject: string;
  desc?: string;
  pictureUrl?: string | null;
  memberCount: number;
  isAdmin: boolean;
  creation?: number;
  owner?: string;
  settings: GroupSecuritySettings;
}

interface GroupAdminPanelProps {
  isConnected: boolean;
  isPaired: boolean;
  isReconnecting?: boolean;
  isLicenseExpired?: boolean;
  targetPhone?: string;
  userId?: string;
  onShowToast?: (notification: WhatsAppNotification) => void;
  onGoToPair?: () => void;
}

// Subcomponent: Live Group Picture Avatar with WhatsApp CDN fallback
const GroupAvatar: React.FC<{
  group: GroupItem;
  userId?: string;
}> = ({ group, userId }) => {
  const [imgError, setImgError] = useState(false);
  const [imgUrl, setImgUrl] = useState<string | null>(group.pictureUrl || null);

  useEffect(() => {
    if (group.pictureUrl) {
      setImgUrl(group.pictureUrl);
      setImgError(false);
    } else {
      // Attempt on-demand picture retrieval from server
      let isMounted = true;
      const q = userId ? `?userId=${encodeURIComponent(userId)}` : '';
      fetch(`/api/groups/${encodeURIComponent(group.id)}/picture${q}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (isMounted && data?.pictureUrl) {
            setImgUrl(data.pictureUrl);
            setImgError(false);
          }
        })
        .catch(() => {});
      return () => {
        isMounted = false;
      };
    }
  }, [group.id, group.pictureUrl, userId]);

  const initials = group.subject
    ? group.subject
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join('') || group.subject.slice(0, 2).toUpperCase()
    : 'GP';

  return (
    <div className="relative w-14 h-14 shrink-0 rounded-2xl overflow-hidden ring-2 ring-emerald-500/40 shadow-lg bg-slate-800">
      {imgUrl && !imgError ? (
        <img
          src={imgUrl}
          alt={group.subject}
          className="w-full h-full object-cover transition-transform duration-300 hover:scale-110"
          loading="lazy"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-tr from-emerald-600 via-teal-600 to-cyan-500 flex flex-col items-center justify-center text-slate-950 font-black">
          <span className="text-base tracking-wider">{initials}</span>
          <span className="text-[9px] uppercase tracking-tighter opacity-80 font-bold">Group</span>
        </div>
      )}
      {group.isAdmin && (
        <span
          className="absolute bottom-0 right-0 p-1 bg-amber-500 text-slate-950 rounded-tl-lg shadow-sm"
          title="Admin in this group"
        >
          <Crown className="w-3 h-3 fill-slate-950" />
        </span>
      )}
    </div>
  );
};

export const GroupAdminPanel: React.FC<GroupAdminPanelProps> = ({
  isConnected,
  isPaired,
  isReconnecting = false,
  isLicenseExpired = false,
  targetPhone,
  userId,
  onShowToast,
  onGoToPair,
}) => {
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingToggles, setPendingToggles] = useState<Record<string, boolean>>({});
  const [groupSyncWarning, setGroupSyncWarning] = useState<string | null>(null);
  const groupsRequestInFlight = useRef(false);

  // Fetch real groups from server (Admin groups only)
  const fetchGroups = async (isManualSync = false) => {
    // If not connected, do not attempt to fetch or show groups
    if (!isConnected) {
      setLoading(false);
      return;
    }
    if (groupsRequestInFlight.current) return;
    groupsRequestInFlight.current = true;

    if (isManualSync) {
      setSyncing(true);
    } else {
      setLoading(true);
    }

    try {
      const q = userId ? `&userId=${encodeURIComponent(userId)}` : '';
      const endpoint = isManualSync
        ? `/api/groups/sync?${userId ? `userId=${encodeURIComponent(userId)}` : ''}`
        : `/api/groups?adminOnly=true${q}`;
      const method = isManualSync ? 'POST' : 'GET';
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(isManualSync && userId ? { body: JSON.stringify({ userId }) } : {}),
      }).catch(() => null);

      if (res && res.ok) {
        const data = await safeParseJson<{
          success: boolean;
          connected?: boolean;
          groups?: GroupItem[];
        }>(res);

        if (data && Array.isArray(data.groups)) {
          // STRICT REQUIREMENT: Keep only groups where the account is an Admin
          // Remove all non-admin groups so members cannot modify protection
          const adminOnlyGroups = data.groups.filter((group) => group.isAdmin);
          if (data.connected === false) {
            setGroupSyncWarning(
              'WhatsApp could not confirm the connection. The last confirmed groups are being kept.'
            );
          } else if (!isManualSync && adminOnlyGroups.length === 0 && groups.length > 0) {
            setGroupSyncWarning(
              'This background check returned no groups. Your last confirmed groups are still shown; use Sync & Detect Groups to verify them.'
            );
          } else {
            setGroups(adminOnlyGroups);
            setGroupSyncWarning(null);
          }

          if (isManualSync) {
            onShowToast?.({
              id: 'group_sync_' + Date.now(),
              type: 'system',
              title: 'Admin Groups Synchronized 🔄',
              body: `Synced ${adminOnlyGroups.length} verified WhatsApp admin groups with Firebase Firestore.`,
              timestamp: new Date().toLocaleTimeString(),
            });
          }
        } else {
          setGroupSyncWarning('The group list could not be confirmed. Use Sync & Detect Groups to retry.');
        }
      } else {
        setGroupSyncWarning('The group list could not be loaded. Use Sync & Detect Groups to retry.');
      }
    } catch (err) {
      console.error('Failed to fetch groups:', err);
      setGroupSyncWarning('The group list could not be loaded. Use Sync & Detect Groups to retry.');
    } finally {
      groupsRequestInFlight.current = false;
      setLoading(false);
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (isConnected) {
      void fetchGroups();
    } else {
      setLoading(false);
    }
  }, [isConnected, userId]);

  // Handle single switch toggle
  const handleToggleSetting = async (
    groupId: string,
    key: keyof GroupSecuritySettings,
    currentValue: boolean
  ) => {
    const nextVal = !currentValue;
    const toggleKey = `${groupId}:${key}`;
    setPendingToggles((prev) => ({ ...prev, [toggleKey]: true }));

    // Optimistic UI update
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id === groupId) {
          return {
            ...g,
            settings: {
              ...g.settings,
              [key]: nextVal,
            },
          };
        }
        return g;
      })
    );

    try {
      const res = await fetch('/api/groups/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, key, value: nextVal, userId }),
      });

      if (res.ok) {
        const keyNames: Record<string, string> = {
          autowelcome: 'Auto-Welcome Greeter',
          autogoodbye: 'Auto-Goodbye Farewell',
          antilink: 'Anti-Link Protection',
          antibot: 'Anti-Bot Guard',
          antistatus: 'Anti-Status Defense',
          antispam: 'Anti-Spam & Flood Purge',
        };
        onShowToast?.({
          id: 'setting_upd_' + Date.now(),
          type: 'system',
          title: `${keyNames[key] || key} ${nextVal ? 'ON 🟢' : 'OFF ⚪'}`,
          body: `Group setting saved and synced to Firebase Firestore across all admins.`,
          timestamp: new Date().toLocaleTimeString(),
        });
      } else {
        // Revert on failure
        setGroups((prev) =>
          prev.map((g) => {
            if (g.id === groupId) {
              return {
                ...g,
                settings: {
                  ...g.settings,
                  [key]: currentValue,
                },
              };
            }
            return g;
          })
        );
      }
    } catch (err) {
      console.error('Error toggling group setting:', err);
      // Revert on network error
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id === groupId) {
            return {
              ...g,
              settings: {
                ...g.settings,
                [key]: currentValue,
              },
            };
          }
          return g;
        })
      );
    } finally {
      setPendingToggles((prev) => ({ ...prev, [toggleKey]: false }));
    }
  };

  // Turn ALL anti-features & welcome ON or OFF for a group
  const handleToggleAllForGroup = async (groupId: string, enableAll: boolean) => {
    // Optimistic update
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id === groupId) {
          return {
            ...g,
            settings: {
              autowelcome: enableAll,
              autogoodbye: enableAll,
              antilink: enableAll,
              antibot: enableAll,
              antistatus: enableAll,
              antispam: enableAll,
              warnLimit: g.settings?.warnLimit || 3,
            },
          };
        }
        return g;
      })
    );

    try {
      const res = await fetch('/api/groups/toggle-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, enableAll, userId }),
      });

      if (res.ok) {
        onShowToast?.({
          id: 'toggle_all_' + Date.now(),
          type: 'system',
          title: enableAll ? 'All Protections ON 🛡️' : 'All Protections OFF ⚪',
          body: `All auto-greetings & anti switches for group synced to ${enableAll ? 'ACTIVE' : 'DISABLED'}.`,
          timestamp: new Date().toLocaleTimeString(),
        });
      }
    } catch (err) {
      console.error('Error toggling all group settings:', err);
    }
  };

  // Change warning limit for a group
  const handleChangeWarnLimit = async (groupId: string, limit: number) => {
    // Optimistic update
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id === groupId) {
          return {
            ...g,
            settings: {
              ...g.settings,
              warnLimit: limit,
            },
          };
        }
        return g;
      })
    );

    try {
      await fetch('/api/groups/warn-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, limit, userId }),
      });
      onShowToast?.({
        id: 'warn_limit_' + Date.now(),
        type: 'system',
        title: `Warning Limit Set to ${limit} ⚠️`,
        body: `Members will receive ${limit} warnings before automatic group ejection.`,
        timestamp: new Date().toLocaleTimeString(),
      });
    } catch (err) {
      console.error('Error setting warn limit:', err);
    }
  };

  const handleCopyJid = (jid: string) => {
    navigator.clipboard.writeText(jid);
    setCopiedId(jid);
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Filter groups — strictly admin-only groups
  const filteredGroups = useMemo(() => {
    return groups.filter((g) => {
      // STRICT REQUIREMENT: Only groups where your connected account is an Admin
      // Remove all non-admin groups so members cannot modify protection
      if (!g.isAdmin) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        g.subject.toLowerCase().includes(q) ||
        g.id.toLowerCase().includes(q) ||
        (g.desc && g.desc.toLowerCase().includes(q))
      );
    });
  }, [groups, searchQuery]);

  // STRICT USER REQUIREMENT:
  // "Once your button not linked to the account, the group that will show, don't let it show any group.
  // Say link account first to show your groups that you are in. Link account first to show you the group you are in.
  // So for you to know the group the person is in, they have to link account first."
  if (!isConnected && !isPaired) {
    return (
      <div className="space-y-6">
        <div className="p-8 sm:p-10 rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-amber-950/30 border border-amber-500/30 shadow-2xl relative overflow-hidden text-center">
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-56 h-56 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="max-w-xl mx-auto space-y-5">
            <div className="w-16 h-16 rounded-3xl bg-amber-500/20 text-amber-400 border border-amber-500/30 mx-auto flex items-center justify-center shadow-lg shadow-amber-500/10">
              <Lock className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                WhatsApp Account Link Required
              </span>
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                Link Account First to Show Your Groups
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                To protect your privacy and ensure only your genuine groups are displayed, no groups
                can be shown until you link your WhatsApp account.
              </p>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed bg-slate-950/70 p-4 rounded-2xl border border-slate-800">
              Once linked, this panel will automatically load all the <strong>real groups</strong> you
              are in, their <strong>official pictures</strong>, <strong>genuine titles</strong>, and
              detect where you are an <strong>admin</strong> so you can configure greeting and
              anti-protection switches.
            </p>

            <div className="pt-2">
              <button
                type="button"
                onClick={onGoToPair}
                className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black text-sm flex items-center justify-center gap-2.5 mx-auto transition-all shadow-xl shadow-emerald-500/20 cursor-pointer"
              >
                <Smartphone className="w-5 h-5" />
                <span>Link WhatsApp Account Now</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Quick 3-step guide */}
            <div className="pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                  Step 1
                </span>
                <h4 className="text-xs font-bold text-white">Enter Phone Number</h4>
                <p className="text-[11px] text-slate-400">
                  Provide your WhatsApp number with country code on the Link Device screen.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                  Step 2
                </span>
                <h4 className="text-xs font-bold text-white">Pair in WhatsApp</h4>
                <p className="text-[11px] text-slate-400">
                  Enter the 8-digit code in WhatsApp under Linked Devices &gt; Link with phone number.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                  Step 3
                </span>
                <h4 className="text-xs font-bold text-white">Manage Real Groups</h4>
                <p className="text-[11px] text-slate-400">
                  Return here to see all your real groups with real pictures and turn on defense.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-emerald-950/40 border border-emerald-500/30 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 -mr-12 -mt-12 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <img
                src="/solva.webp"
                alt="SOLVATECH"
                className="w-9 h-9 rounded-xl object-cover ring-1 ring-emerald-500/40 shadow-md shrink-0"
              />
              <span className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <Crown className="w-5 h-5" />
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                My Groups & Admin Defense
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                Firebase Synced ☁️
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Every real group where your connected WhatsApp account is an <strong>Admin</strong>.
              Toggle Auto-Welcome, Auto-Goodbye, and Anti-Defense matrices anytime. Settings remain
              active and persistent in Firebase Firestore even if disconnected.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => fetchGroups(true)}
              disabled={syncing || !isConnected}
              className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-bold text-xs flex items-center gap-2 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Syncing...' : 'Sync & Detect Groups'}</span>
            </button>
          </div>
        </div>

        {/* Live sync banner */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span>
              Connected Account:{' '}
              <strong className="text-white">
                {targetPhone ? `+${targetPhone}` : 'Live WhatsApp Socket Connected'}
              </strong>
            </span>
          </div>
          <div className="text-[11px] text-slate-400">
            Defaults: <span className="text-emerald-300 font-semibold">All Switches Enabled (ON)</span> by default
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search groups by real name or JID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <div className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm flex items-center gap-1.5">
            <Crown className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span>Admin Protected Groups ({filteredGroups.length})</span>
          </div>
        </div>
      </div>

      {groupSyncWarning && (
        <div
          role="status"
          className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200"
        >
          {groupSyncWarning}
        </div>
      )}

      {!isConnected && (
        <div
          role="status"
          className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200"
        >
          {isLicenseExpired
            ? 'Your WhatsApp device is still linked, but license access is paused. Your last loaded groups are kept here.'
            : isReconnecting
            ? 'WhatsApp is reconnecting in the background. Your last loaded groups are kept here; group changes will be available when the connection is back.'
            : 'Your WhatsApp device is linked but paused. Your last loaded groups are kept here; group changes are available after you resume the bot.'}
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && groups.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-slate-900/50 border border-slate-800 text-slate-400 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin" />
          <p className="text-sm font-medium">Fetching live WhatsApp groups where you are an admin...</p>
        </div>
      ) : groupSyncWarning && groups.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-slate-900/50 border border-amber-500/30 text-slate-400 space-y-3">
          <AlertTriangle className="w-10 h-10 text-amber-400/80 mx-auto" />
          <h3 className="text-base font-bold text-white">Group list not confirmed</h3>
          <p className="text-xs max-w-md mx-auto text-slate-400">{groupSyncWarning}</p>
          <button
            type="button"
            onClick={() => fetchGroups(true)}
            disabled={syncing || !isConnected}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs inline-flex items-center gap-2 cursor-pointer transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>Sync & Detect Groups</span>
          </button>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-slate-900/50 border border-slate-800 text-slate-400 space-y-3">
          <Crown className="w-10 h-10 text-amber-500/70 mx-auto" />
          <h3 className="text-base font-bold text-white">
            No Admin Groups Detected
          </h3>
          <p className="text-xs max-w-md mx-auto text-slate-400">
            To prevent regular members from changing group protections, only groups where your connected WhatsApp account is an <strong>Administrator</strong> are loaded. Make this account an admin in a group and tap &ldquo;Sync &amp; Detect Groups&rdquo;.
          </p>
          <button
            type="button"
            onClick={() => fetchGroups(true)}
            disabled={syncing}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs inline-flex items-center gap-2 cursor-pointer transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>Sync & Detect Groups</span>
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <div
            aria-disabled={!isConnected}
            className={`space-y-4 ${!isConnected ? 'pointer-events-none opacity-60' : ''}`}
          >
            {filteredGroups.map((group) => {
            const sec = group.settings || {
              autowelcome: true,
              autogoodbye: true,
              antilink: true,
              antibot: true,
              antistatus: true,
              antispam: true,
              warnLimit: 3,
            };

            const allEnabled =
              sec.autowelcome &&
              sec.autogoodbye &&
              sec.antilink &&
              sec.antibot &&
              sec.antistatus &&
              sec.antispam;

            return (
              <div
                key={group.id}
                className="p-5 sm:p-6 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700/80 transition-all shadow-xl space-y-5"
              >
                {/* Group Card Header with REAL Picture and REAL Name */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
                  <div className="flex items-start gap-4">
                    {/* Real Group Picture Avatar */}
                    <GroupAvatar group={group} userId={userId} />

                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Real Group Name */}
                        <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                          {group.subject}
                        </h3>
                        {group.isAdmin ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                            <Crown className="w-3 h-3 fill-amber-300" />
                            <span>You are Admin</span>
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                            Member
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800/90 text-slate-300 border border-slate-700/80">
                          👥 {group.memberCount} members
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-slate-400">
                        <span className="font-mono text-slate-500 text-[10px] sm:text-xs">
                          {group.id}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyJid(group.id)}
                          className="hover:text-emerald-400 transition-colors p-0.5 cursor-pointer"
                          title="Copy Group JID"
                        >
                          {copiedId === group.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>

                      {group.desc && (
                        <p className="text-[11px] text-slate-400 line-clamp-1 italic max-w-xl">
                          &ldquo;{group.desc}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Quick Group Action Buttons */}
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                    <button
                      type="button"
                      onClick={() => handleToggleAllForGroup(group.id, true)}
                      disabled={allEnabled}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                        allEnabled
                          ? 'bg-emerald-950/40 text-emerald-500/50 border border-emerald-900/30 cursor-not-allowed'
                          : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 active:scale-95'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>All ON</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleAllForGroup(group.id, false)}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 border border-slate-700 transition-all cursor-pointer"
                    >
                      <span>All OFF</span>
                    </button>
                  </div>
                </div>

                {/* Switches Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {/* 1. Auto-Welcome */}
                  <div
                    onClick={() => handleToggleSetting(group.id, 'autowelcome', sec.autowelcome)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 select-none ${
                      sec.autowelcome
                        ? 'bg-emerald-950/30 border-emerald-500/40 hover:bg-emerald-950/40'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">👋</span>
                        <span className="text-xs font-bold text-white">Auto-Welcome Greeter</span>
                        {sec.autowelcome && (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/20 px-1.5 py-0.2 rounded">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-tight">
                        Tags newly joined users (@user), sends group rules, description, and member
                        count. Sent strictly by admin bot.
                      </p>
                    </div>

                    <div
                      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 p-0.5 ${
                        sec.autowelcome ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-white transition-transform ${
                          sec.autowelcome ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </div>

                  {/* 2. Auto-Goodbye */}
                  <div
                    onClick={() => handleToggleSetting(group.id, 'autogoodbye', sec.autogoodbye)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 select-none ${
                      sec.autogoodbye
                        ? 'bg-emerald-950/30 border-emerald-500/40 hover:bg-emerald-950/40'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🚪</span>
                        <span className="text-xs font-bold text-white">Auto-Goodbye Farewell</span>
                        {sec.autogoodbye && (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/20 px-1.5 py-0.2 rounded">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-tight">
                        Sends farewell message tagging departing or removed participants with remaining
                        member tally.
                      </p>
                    </div>

                    <div
                      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 p-0.5 ${
                        sec.autogoodbye ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-white transition-transform ${
                          sec.autogoodbye ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </div>

                  {/* 3. Anti-Link */}
                  <div
                    onClick={() => handleToggleSetting(group.id, 'antilink', sec.antilink)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 select-none ${
                      sec.antilink
                        ? 'bg-emerald-950/30 border-emerald-500/40 hover:bg-emerald-950/40'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🌐</span>
                        <span className="text-xs font-bold text-white">Anti-Link Defense</span>
                        {sec.antilink && (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/20 px-1.5 py-0.2 rounded">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-tight">
                        Auto-deletes external group links and phishing URLs, issuing security warnings
                        to the sender.
                      </p>
                    </div>

                    <div
                      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 p-0.5 ${
                        sec.antilink ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-white transition-transform ${
                          sec.antilink ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </div>

                  {/* 4. Anti-Bot */}
                  <div
                    onClick={() => handleToggleSetting(group.id, 'antibot', sec.antibot)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 select-none ${
                      sec.antibot
                        ? 'bg-emerald-950/30 border-emerald-500/40 hover:bg-emerald-950/40'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🤖</span>
                        <span className="text-xs font-bold text-white">Anti-Bot Guard</span>
                        {sec.antibot && (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/20 px-1.5 py-0.2 rounded">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-tight">
                        Auto-detects non-admin bot abuse, prefix triggers, or unauthorized automated
                        scripts.
                      </p>
                    </div>

                    <div
                      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 p-0.5 ${
                        sec.antibot ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-white transition-transform ${
                          sec.antibot ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </div>

                  {/* 5. Anti-Status Mention */}
                  <div
                    onClick={() => handleToggleSetting(group.id, 'antistatus', sec.antistatus)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 select-none ${
                      sec.antistatus
                        ? 'bg-emerald-950/30 border-emerald-500/40 hover:bg-emerald-950/40'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">📱</span>
                        <span className="text-xs font-bold text-white">Anti-Status Mention</span>
                        {sec.antistatus && (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/20 px-1.5 py-0.2 rounded">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-tight">
                        Auto-deletes spam alerts created when members mention the group in their WhatsApp
                        status.
                      </p>
                    </div>

                    <div
                      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 p-0.5 ${
                        sec.antistatus ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-white transition-transform ${
                          sec.antistatus ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </div>

                  {/* 6. Anti-Spam & Flood Purge */}
                  <div
                    onClick={() => handleToggleSetting(group.id, 'antispam', sec.antispam)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 select-none ${
                      sec.antispam
                        ? 'bg-emerald-950/30 border-emerald-500/40 hover:bg-emerald-950/40'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🚫</span>
                        <span className="text-xs font-bold text-white">Anti-Spam & Flood Purge</span>
                        {sec.antispam && (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/20 px-1.5 py-0.2 rounded">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-tight">
                        Purges rapid flood stickers/media and instantly kicks members if they continue
                        spamming.
                      </p>
                    </div>

                    <div
                      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 p-0.5 ${
                        sec.antispam ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-white transition-transform ${
                          sec.antispam ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </div>
                </div>

                {/* Warning Limit Controls */}
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <div>
                      <span className="text-white font-semibold">Security Warning Threshold:</span>{' '}
                      <span className="text-slate-400">
                        Violators are kicked automatically after {sec.warnLimit || 3} warnings.
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 5].map((limit) => (
                      <button
                        key={limit}
                        type="button"
                        onClick={() => handleChangeWarnLimit(group.id, limit)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          (sec.warnLimit || 3) === limit
                            ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                            : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                        }`}
                      >
                        {limit} Warns
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}

      {/* Info Callout: Chat Commands & Persistence Note */}
      <div className="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800/80 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
          <Info className="w-4 h-4" />
          <span>Universal Sync & Chat Command Equivalents</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          You and any group admin can also control these features directly in WhatsApp chat at any
          time using the following commands:
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
            <span className="text-emerald-400 font-bold">.autowelcome on/off</span>
          </div>
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
            <span className="text-emerald-400 font-bold">.autogoodbye on/off</span>
          </div>
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
            <span className="text-emerald-400 font-bold">.antilink on/off</span>
          </div>
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
            <span className="text-emerald-400 font-bold">.antibot on/off</span>
          </div>
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
            <span className="text-emerald-400 font-bold">.antistatus on/off</span>
          </div>
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
            <span className="text-emerald-400 font-bold">.antispam on/off</span>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 pt-1">
          🔒 <strong>Zero Reset Guarantee:</strong> Configuration is stored in Firebase Firestore
          keyed by Group JID. Even if you disconnect, reconnect, or restart the server, all settings
          stay intact and active automatically!
        </p>
      </div>
    </div>
  );
};
