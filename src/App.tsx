import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, onAuthChange } from './services/firebase';
import { COUNTRIES, Country } from './data/countries';
import { CountrySelect } from './components/CountrySelect';
import { AuthModal } from './components/AuthModal';
import { UserAccountNav } from './components/UserAccountNav';
import { AdminDashboard } from './components/AdminDashboard';
import {
  OWNER_EMAIL,
  calculateRemainingTime,
  redeemKey,
  LICENSE_PLANS,
  PAYMENT_INFO,
} from './services/license';

interface WhatsAppStatus {
  state: 'disconnected' | 'connecting' | 'awaiting_pairing' | 'connected';
  isConnected: boolean;
  user?: {
    id: string;
    name?: string;
    phone?: string;
  };
  pairingCode?: string;
  qrCodeUrl?: string;
  targetPhone?: string;
  lastError?: string;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);

  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0]); // Default Nigeria 🇳🇬 (+234)
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'pair' | 'license' | 'commands'>('pair');

  const [status, setStatus] = useState<WhatsAppStatus>({
    state: 'disconnected',
    isConnected: false,
  });
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(120);

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

  const [remainingTimeDisplay, setRemainingTimeDisplay] = useState<string>('Checking...');
  const [inTabKeyInput, setInTabKeyInput] = useState('');
  const [inTabRedeeming, setInTabRedeeming] = useState(false);
  const [inTabSuccess, setInTabSuccess] = useState<string | null>(null);
  const [inTabError, setInTabError] = useState<string | null>(null);
  const [commandSearch, setCommandSearch] = useState('');

  // Check if owner
  const isOwner =
    currentUser?.email?.toLowerCase() === OWNER_EMAIL.toLowerCase() ||
    currentUser?.email?.toLowerCase() === 'solomonoladimeji9049@gmail.com' ||
    userLicenseData.isUnlimited;

  // Listen to Auth State and real-time Firestore license sync
  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      setCurrentUser(user);
      setAuthLoading(false);

      if (user) {
        const saved = localStorage.getItem(`solvatech_user_${user.uid}`);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            setUserLicenseData({
              expiresAt: parsed.licenseExpiresAt || null,
              isUnlimited: !!parsed.isUnlimited,
              plan: parsed.licensePlan || 'Active Plan',
              key: parsed.licenseKey || null,
            });
          } catch (e) {
            console.error('Failed to parse saved user license:', e);
          }
        }

        // Real-time Firestore sync: instantly reflects Admin Unlimited toggle!
        try {
          onSnapshot(doc(db, 'users', user.uid), (snap) => {
            if (snap.exists()) {
              const data = snap.data();
              setUserLicenseData({
                expiresAt: data.licenseExpiresAt || null,
                isUnlimited: !!data.isUnlimited,
                plan: data.licensePlan || (data.isUnlimited ? '👑 Unlimited Lifetime (Admin Granted)' : 'Active Plan'),
                key: data.licenseKey || null,
              });
            }
          });
        } catch (e) {
          console.warn('Firestore user listener warning:', e);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Real-time ticking Countdown Timer (down to seconds & accurate stacking)
  useEffect(() => {
    const updateTime = () => {
      const info = calculateRemainingTime(
        userLicenseData.expiresAt,
        isOwner || userLicenseData.isUnlimited
      );
      setRemainingTimeDisplay(info.formatted);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [userLicenseData, isOwner]);

  // Polling backend status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const resStatus = await fetch('/api/whatsapp/status');
        if (resStatus.ok) {
          const data = await resStatus.json();
          if (data.status) {
            setStatus(data.status);
            if (data.status.pairingCode) {
              setPairingCode(data.status.pairingCode);
            } else if (data.status.isConnected) {
              setPairingCode(null);
            }
          }
        }
      } catch (err) {
        console.error('Error polling WhatsApp status:', err);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Countdown timer for pairing code (120s)
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (pairingCode && countdown > 0 && !status.isConnected) {
      timer = setInterval(() => {
        setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [pairingCode, countdown, status.isConnected]);

  // Handle request pairing code (With Auto-Switch to License if Expired or Missing)
  const handleRequestPairingCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!phoneNumber) return;

    if (!currentUser) {
      setIsAuthModalOpen(true);
      return;
    }

    // CHECK LICENSE: Auto switch to License tab if expired and not owner
    const licenseCheck = calculateRemainingTime(userLicenseData.expiresAt, isOwner || userLicenseData.isUnlimited);
    if (!isOwner && !userLicenseData.isUnlimited && licenseCheck.isExpired) {
      setActiveTab('license');
      setInTabError('⚠️ License Required: Your key has expired or you do not have an active key. Please enter your key below or pick a plan to connect WhatsApp!');
      return;
    }

    let cleanEntered = phoneNumber.replace(/\D/g, '');
    if (cleanEntered.startsWith('0')) {
      cleanEntered = cleanEntered.substring(1);
    }

    const cleanDial = selectedCountry.dialCode.replace(/\D/g, '');
    const fullNumber = `${cleanDial}${cleanEntered}`;

    setLoading(true);
    setPairingError(null);

    try {
      const res = await fetch('/api/whatsapp/pair-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: fullNumber }),
      });

      const data = await res.json();
      if (data.success) {
        setPairingCode(data.pairingCode);
        setCountdown(120);
        setStatus((prev) => ({
          ...prev,
          state: 'awaiting_pairing',
          pairingCode: data.pairingCode,
          targetPhone: `+${fullNumber}`,
        }));
      } else {
        setPairingError(data.error || 'Failed to request pairing code');
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

  const handleLogoutWhatsApp = async () => {
    if (!confirm('Unlink this WhatsApp session?')) return;
    setLoading(true);
    try {
      await fetch('/api/whatsapp/logout', { method: 'POST' });
      setPairingCode(null);
      setStatus({ state: 'disconnected', isConnected: false });
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

    setInTabRedeeming(true);
    setInTabSuccess(null);
    setInTabError(null);

    try {
      const res = await redeemKey(
        currentUser?.uid || 'user_guest',
        currentUser?.email || 'guest@solvatech.com',
        inTabKeyInput
      );

      if (res.success) {
        setInTabSuccess(res.message);
        setInTabKeyInput('');
        setUserLicenseData((prev) => ({
          ...prev,
          expiresAt: res.expiresAt || prev.expiresAt,
          plan: 'Active Paid Plan',
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

  const fullCleanPhone = phoneNumber
    ? `${selectedCountry.dialCode} ${phoneNumber.replace(/\D/g, '')}`
    : '';

  const isLicenseActive = isOwner || userLicenseData.isUnlimited || !calculateRemainingTime(userLicenseData.expiresAt, false).isExpired;

  // Compact bot commands list
  const BOT_COMMANDS = [
    { cmd: '.menu', desc: 'Display all bot commands & active bot info' },
    { cmd: '.ping', desc: 'Check network speed and response latency' },
    { cmd: '.uptime', desc: 'Bot continuous runtime and server status' },
    { cmd: '.expire', desc: 'Check your license expiry & remaining days/minutes' },
    { cmd: '.ai <prompt>', desc: 'Ask AI question, writing or explanations' },
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
    { cmd: '.antilink on/off', desc: 'Automatically remove external group links' },
    { cmd: '.antibot on/off', desc: 'Auto-kick unauthorized bot accounts' },
    { cmd: '.warn @user', desc: 'Issue warning to group participant' },
    { cmd: '.owner', desc: 'Developer & Solomon contact details' },
  ];

  const filteredCommands = BOT_COMMANDS.filter(
    (c) => c.cmd.toLowerCase().includes(commandSearch.toLowerCase()) || c.desc.toLowerCase().includes(commandSearch.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-0 sm:p-4 font-sans select-none sm:select-auto">
      {/* Phone Mockup Container — Compact, Single Screen, Zero Overlapping */}
      <div className="w-full sm:max-w-md bg-slate-900 sm:border border-slate-800 sm:rounded-[36px] rounded-none shadow-2xl flex flex-col h-screen sm:h-[840px] max-h-screen sm:max-h-[840px] overflow-hidden relative">
        
        {/* Top Phone Status & Header */}
        <header className="px-4 pt-3 pb-2.5 bg-slate-950 border-b border-slate-800/80 flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-md shadow-emerald-950/60">
                <Smartphone className="w-4 h-4 text-slate-950 font-bold" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h1 className="font-extrabold text-sm text-white tracking-tight">SOLVATECH</h1>
                  <span className={`w-2 h-2 rounded-full ${status.isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                </div>
                <p className="text-[10px] text-slate-400 font-mono">
                  {status.isConnected ? 'WhatsApp Linked' : 'Baileys Multi-Device'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Owner Admin Hub Button */}
              {isOwner && (
                <button
                  onClick={() => setIsAdminModalOpen(true)}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[11px] font-bold flex items-center gap-1 transition-all"
                  title="Open Admin Management"
                >
                  <Key className="w-3 h-3 text-amber-400" />
                  <span>Admin</span>
                </button>
              )}

              {/* User Account / Google Sign-in */}
              <UserAccountNav
                user={currentUser}
                onOpenAuthModal={() => setIsAuthModalOpen(true)}
              />
            </div>
          </div>

          {/* Real-time License Countdown Banner (Click to switch to License Tab) */}
          <button
            onClick={() => setActiveTab('license')}
            className={`w-full px-3 py-1.5 rounded-xl border flex items-center justify-between text-left transition-all ${
              isLicenseActive
                ? 'bg-emerald-950/30 border-emerald-500/40 hover:bg-emerald-950/40'
                : 'bg-rose-950/30 border-rose-500/40 hover:bg-rose-950/40'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Clock className={`w-3.5 h-3.5 shrink-0 ${isLicenseActive ? 'text-emerald-400 animate-pulse' : 'text-rose-400'}`} />
              <div className="truncate">
                <span className="text-[10px] text-slate-400 block leading-tight">License Time:</span>
                <span className={`text-xs font-bold font-mono ${isLicenseActive ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {remainingTimeDisplay}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 text-[10px] font-bold text-slate-300 bg-slate-900/90 px-2 py-0.5 rounded-md border border-slate-700/60">
              <span>{isOwner || userLicenseData.isUnlimited ? '👑 VIP' : 'Stack / Add'}</span>
              <Zap className="w-2.5 h-2.5 text-amber-400" />
            </div>
          </button>
        </header>

        {/* Phone Content Body — Clean, Focused, No Bloat */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* TAB 1: PAIR WHATSAPP */}
          {activeTab === 'pair' && (
            <div className="space-y-4">
              {/* WhatsApp Connection Status Card */}
              {status.isConnected ? (
                <div className="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 space-y-3">
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
                </div>
              ) : (
                /* Pairing Form */
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-800/80">
                    <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                    <h3 className="font-bold text-sm text-white">Link Your WhatsApp</h3>
                  </div>

                  {/* Expired / No License Auto-Alert */}
                  {!isLicenseActive && (
                    <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-300 text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                      <div>
                        <p className="font-semibold">License Key Required</p>
                        <p className="text-[11px] text-amber-300/80 mt-0.5">
                          You need an active key to link WhatsApp.
                        </p>
                        <button
                          type="button"
                          onClick={() => setActiveTab('license')}
                          className="mt-1.5 px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-bold text-[11px] flex items-center gap-1"
                        >
                          <span>Redeem Key Now</span>
                          <Zap className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}

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
                    </div>

                    <button
                      type="submit"
                      disabled={loading || !phoneNumber}
                      className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-bold text-xs shadow-md disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                    >
                      {loading ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Generating Pairing Code...</span>
                        </>
                      ) : (
                        <>
                          <KeyRound className="w-4 h-4 text-slate-950" />
                          <span>Get 8-Digit Pairing Code</span>
                        </>
                      )}
                    </button>

                    {pairingError && (
                      <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs">
                        {pairingError}
                      </div>
                    )}
                  </form>

                  {/* Active Pairing Code Display */}
                  {pairingCode && (
                    <div className="mt-3 p-4 rounded-xl bg-slate-900 border border-emerald-500/40 space-y-3">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span className="text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Code Ready
                        </span>
                        <span className="font-mono text-slate-400 text-[11px]">
                          Expires in: <strong className="text-white">{countdown}s</strong>
                        </span>
                      </div>

                      <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-950 border border-slate-800">
                        <span className="font-mono text-2xl font-extrabold tracking-widest text-emerald-400 select-all">
                          {pairingCode}
                        </span>
                        <button
                          type="button"
                          onClick={handleCopyCode}
                          className="p-2 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                          title="Copy Code"
                        >
                          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>

                      <div className="text-[11px] text-slate-300 space-y-1 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                        <p className="font-semibold text-white">How to link in WhatsApp:</p>
                        <ol className="list-decimal list-inside space-y-0.5 text-slate-400">
                          <li>Open WhatsApp on your phone</li>
                          <li>Tap <strong>Linked Devices</strong> → <strong>Link a Device</strong></li>
                          <li>Tap <strong className="text-emerald-400">Link with phone number instead</strong></li>
                          <li>Enter code above: <strong className="text-emerald-400 font-mono">{pairingCode}</strong></li>
                        </ol>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: REDEEM KEY & PLANS (AUTOMATIC SWITCH DESTINATION) */}
          {activeTab === 'license' && (
            <div className="space-y-4">
              {/* Key Input & Stacking */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-emerald-400" />
                    <h3 className="font-bold text-sm text-white">Redeem License Key</h3>
                  </div>
                  <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    Stacking Active
                  </span>
                </div>

                <p className="text-[11px] text-slate-400">
                  Redeeming keys <strong>adds time accurately</strong> onto your existing balance.
                </p>

                <form onSubmit={handleRedeemInTab} className="space-y-2.5">
                  <input
                    type="text"
                    placeholder="e.g. SOLVA-7D-A1B2-C3D4"
                    value={inTabKeyInput}
                    onChange={(e) => setInTabKeyInput(e.target.value.toUpperCase())}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono tracking-wider"
                    required
                  />

                  <button
                    type="submit"
                    disabled={inTabRedeeming || !inTabKeyInput.trim()}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 text-slate-950 font-bold text-xs shadow-md disabled:opacity-50 transition-all"
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

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                  <span>No key? Choose a plan below</span>
                  <span className="text-emerald-400 font-medium">OPay: 9049979183</span>
                </div>
              </div>

              {/* Official Plans & OPay Payment Details */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-emerald-400">
                    ⚔️ LICENSE PLANS
                  </h4>
                  <span className="text-[10px] text-slate-500 font-mono">OPay Bank</span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  {LICENSE_PLANS.map((plan) => (
                    <div
                      key={plan.id}
                      className="p-2 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-between"
                    >
                      <span className="text-slate-300">• {plan.name}</span>
                      <strong className="text-emerald-400 font-mono">{plan.priceFormatted}</strong>
                    </div>
                  ))}
                </div>

                {/* OPay Account Box */}
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[11px]">OPay Account:</span>
                    <div className="flex items-center gap-1.5">
                      <strong className="text-emerald-400 font-mono select-all text-sm">
                        {PAYMENT_INFO.accountNumber}
                      </strong>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(PAYMENT_INFO.accountNumber);
                          alert('Copied OPay Account: ' + PAYMENT_INFO.accountNumber);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-white"
                        title="Copy Number"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[11px]">Name:</span>
                    <strong className="text-white text-[11px]">{PAYMENT_INFO.accountName}</strong>
                  </div>
                </div>

                <a
                  href={PAYMENT_INFO.whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition-colors shadow-sm"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Send Payment Proof to Solomon</span>
                </a>
              </div>
            </div>
          )}

          {/* TAB 3: COMMAND DIRECTORY */}
          {activeTab === 'commands' && (
            <div className="space-y-3">
              <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  <h3 className="font-bold text-sm text-white">Bot Commands</h3>
                </div>

                {/* Search Commands */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search command (.ping, .sticker, etc.)..."
                    value={commandSearch}
                    onChange={(e) => setCommandSearch(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Commands List */}
              <div className="space-y-1.5 max-h-[460px] overflow-y-auto pr-1">
                {filteredCommands.map((item) => (
                  <div
                    key={item.cmd}
                    className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-start justify-between gap-2"
                  >
                    <div>
                      <span className="font-mono text-emerald-400 font-bold text-xs">
                        {item.cmd}
                      </span>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Phone App Navigation Bar */}
        <nav className="px-3 py-2 bg-slate-950 border-t border-slate-800/80 flex items-center justify-around shrink-0">
          <button
            onClick={() => setActiveTab('pair')}
            className={`flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-all ${
              activeTab === 'pair'
                ? 'text-emerald-400 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <span className="text-[10px]">Link</span>
          </button>

          <button
            onClick={() => setActiveTab('license')}
            className={`flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-all ${
              activeTab === 'license'
                ? 'text-emerald-400 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Key className="w-4 h-4" />
            <span className="text-[10px]">License</span>
          </button>

          <button
            onClick={() => setActiveTab('commands')}
            className={`flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-all ${
              activeTab === 'commands'
                ? 'text-emerald-400 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span className="text-[10px]">Commands</span>
          </button>

          {isOwner && (
            <button
              onClick={() => setIsAdminModalOpen(true)}
              className="flex flex-col items-center gap-1 py-1 px-4 rounded-xl text-amber-400 hover:text-amber-300 transition-all"
            >
              <Zap className="w-4 h-4" />
              <span className="text-[10px]">Admin</span>
            </button>
          )}
        </nav>
      </div>

      {/* Auth Modal for Google Sign-In */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onSuccess={(user) => {
          setCurrentUser(user);
          setIsAuthModalOpen(false);
        }}
        onClose={() => setIsAuthModalOpen(false)}
      />

      {/* Solomon / Owner Admin Dashboard */}
      {isAdminModalOpen && (
        <AdminDashboard
          currentUserEmail={currentUser?.email}
          onClose={() => setIsAdminModalOpen(false)}
        />
      )}
    </div>
  );
}
