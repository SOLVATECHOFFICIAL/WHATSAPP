import { useState, useEffect } from 'react';
import {
  Smartphone,
  CheckCircle2,
  Copy,
  Check,
  RefreshCw,
  QrCode,
  KeyRound,
  Send,
  LogOut,
  Bell,
  Radio,
  ChevronRight,
  ShieldCheck,
  Terminal,
  Database,
  Sparkles,
  Server,
  Layers,
  Key,
  Flame,
  Info,
  UserCheck,
  Lock
} from 'lucide-react';
import { User } from 'firebase/auth';
import { onAuthChange, signOutUser } from './services/firebase';
import { COUNTRIES, Country } from './data/countries';
import { CountrySelect } from './components/CountrySelect';
import { NotificationsPanel, WhatsAppNotification } from './components/NotificationsPanel';
import { CommandDirectory } from './components/CommandDirectory';
import { ChatSimulator } from './components/ChatSimulator';
import { ImageGeneratorModal } from './components/ImageGeneratorModal';
import { RailwayGuideModal } from './components/RailwayGuideModal';
import { AuthModal } from './components/AuthModal';
import { UserAccountNav } from './components/UserAccountNav';

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

  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0]); // Default Nigeria 🇳🇬 (+234)
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [pairingMode, setPairingMode] = useState<'code' | 'qr'>('code');
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'pair' | 'commands' | 'terminal'>('pair');
  const [commandToRun, setCommandToRun] = useState<string | undefined>(undefined);

  const [status, setStatus] = useState<WhatsAppStatus>({
    state: 'disconnected',
    isConnected: false,
  });
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<WhatsAppNotification[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [countdown, setCountdown] = useState<number>(120);

  // Modals
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [isRailwayModalOpen, setIsRailwayModalOpen] = useState(false);

  // Test outbound message
  const [testToPhone, setTestToPhone] = useState('');
  const [testMessage, setTestMessage] = useState('Hello from SOLVATECH! WhatsApp Baileys is active and linked.');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Polling backend status and notifications
  useEffect(() => {
    const fetchStatusAndNotifications = async () => {
      try {
        const [resStatus, resNotif] = await Promise.all([
          fetch('/api/whatsapp/status'),
          fetch('/api/whatsapp/notifications'),
        ]);

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

        if (resNotif.ok) {
          const data = await resNotif.json();
          if (data.notifications) {
            setNotifications(data.notifications);
          }
        }
      } catch (err) {
        console.error('Error polling WhatsApp status:', err);
      }
    };

    fetchStatusAndNotifications();
    const interval = setInterval(fetchStatusAndNotifications, 2500);
    return () => clearInterval(interval);
  }, []);

  // Countdown timer for pairing code
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (pairingCode && countdown > 0 && !status.isConnected) {
      timer = setInterval(() => {
        setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [pairingCode, countdown, status.isConnected]);

  // Handle request pairing code
  const handleRequestPairingCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!phoneNumber) return;

    if (!currentUser) {
      setIsAuthModalOpen(true);
      return;
    }

    let cleanEntered = phoneNumber.replace(/\D/g, '');
    if (cleanEntered.startsWith('0')) {
      cleanEntered = cleanEntered.substring(1);
    }

    const cleanDial = selectedCountry.dialCode.replace(/\D/g, '');
    const fullNumber = `${cleanDial}${cleanEntered}`;

    setLoading(true);
    setTestResult(null);

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
        alert(data.error || 'Failed to request pairing code');
      }
    } catch (err: any) {
      alert(err.message || 'Error communicating with Baileys server');
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
    if (!confirm('Are you sure you want to unlink and clear this WhatsApp session?')) return;
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

  const handleClearNotifications = async () => {
    try {
      await fetch('/api/whatsapp/notifications', { method: 'DELETE' });
      setNotifications([]);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testToPhone || !testMessage) return;

    setSendingTest(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/whatsapp/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testToPhone,
          message: testMessage,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult('Message sent successfully through your linked WhatsApp!');
      } else {
        setTestResult(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setTestResult(`Failed: ${err.message}`);
    } finally {
      setSendingTest(false);
    }
  };

  const handleRunCommandFromDirectory = (cmd: string) => {
    setCommandToRun(cmd);
    setActiveTab('terminal');
  };

  const fullCleanPhone = phoneNumber
    ? `${selectedCountry.dialCode} ${phoneNumber.replace(/\D/g, '')}`
    : '';

  const userLicense = currentUser
    ? `SOLVA-${currentUser.uid.slice(0, 6).toUpperCase()}-2026`
    : 'SIGN-IN-REQUIRED';

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40 px-4 lg:px-8 py-3.5">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950/50">
              <Smartphone className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-lg text-white tracking-tight">SOLVATECH</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  WHATSAPP BOT HUB
                </span>
              </div>
              <p className="text-xs text-slate-400">Owner-Only Private WhatsApp Engine & License Portal</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Firebase Sync Indicator */}
            <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-300 font-mono">
              <Database className="w-3.5 h-3.5 text-amber-400" />
              <span>Firebase: <strong className="text-emerald-400">solvatechbot</strong> 🟢</span>
            </div>

            {/* AI Image Studio */}
            <button
              onClick={() => setIsImageModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 text-xs font-semibold transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">AI Studio</span>
            </button>

            {/* Railway 24/7 */}
            <button
              onClick={() => setIsRailwayModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 border border-purple-500/30 text-xs font-semibold transition-all"
            >
              <Server className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Railway 24/7</span>
            </button>

            {/* Notifications Feed Button */}
            <button
              onClick={() => setIsNotifOpen(true)}
              className="relative p-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white transition-all border border-slate-700/60"
              title="Live WhatsApp Notifications"
            >
              <Bell className="w-5 h-5" />
              {notifications.length > 0 && (
                <span className="absolute -top-1 -right-1 px-1.5 py-0.5 min-w-[18px] text-[10px] font-bold bg-emerald-500 text-slate-950 rounded-full text-center">
                  {notifications.length}
                </span>
              )}
            </button>

            {/* Google Account Authentication Nav */}
            <UserAccountNav
              user={currentUser}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
            />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Important WhatsApp Runtime Clarification Banner */}
        <div className="bg-gradient-to-r from-emerald-950/40 via-slate-950 to-slate-950 border border-emerald-500/30 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-sm sm:text-base">
                  SOLVATECH Runs Directly Inside Your Real WhatsApp
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  REAL BAILEYS SOCKET
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                All 35+ commands, automated anti-delete recovery, and responses execute <strong>directly in WhatsApp</strong> on your phone. This website is your control portal to sign in with Google, pair your number, manage your personal account, and view real-time WhatsApp logs.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 text-xs font-mono bg-slate-900/80 px-3.5 py-2 rounded-xl border border-slate-800">
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-400">License:</span>
            <span className="text-emerald-400 font-bold">{userLicense}</span>
          </div>
        </div>

        {/* Account Warning Gate if not logged in */}
        {!currentUser && !authLoading && (
          <div className="bg-gradient-to-r from-amber-950/40 via-slate-950 to-slate-950 border border-amber-500/40 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-white text-sm">Personal Google Account Required</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Sign in with Google so your linked WhatsApp session, license key, and bot settings will never be lost.
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs shadow-md transition-all active:scale-95 shrink-0"
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
              <span>Sign in with Google</span>
            </button>
          </div>
        )}

        {/* Dashboard Tabs */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-3">
          <div className="flex bg-slate-950 p-1.5 rounded-2xl border border-slate-800 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('pair')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
                activeTab === 'pair'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <KeyRound className="w-4 h-4" />
              <span>Link WhatsApp (Baileys)</span>
            </button>
            <button
              onClick={() => setActiveTab('commands')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
                activeTab === 'commands'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Terminal className="w-4 h-4" />
              <span>WhatsApp Commands (35+)</span>
            </button>
            <button
              onClick={() => setActiveTab('terminal')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
                activeTab === 'terminal'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Radio className="w-4 h-4" />
              <span>Preview Terminal</span>
            </button>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
            <span className="relative flex h-2 w-2">
              {status.isConnected ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </>
              ) : status.state === 'awaiting_pairing' ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-500"></span>
              )}
            </span>
            <span className="font-mono text-slate-300">
              {status.isConnected ? `Linked WhatsApp: ${status.user?.phone || 'Online'}` : 'Not Linked Yet'}
            </span>
          </div>
        </div>

        {/* TAB 1: BAILEYS PAIRING (STEP 1) */}
        {activeTab === 'pair' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Main Pairing Card */}
            <div className="lg:col-span-7 bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <Radio className="w-5 h-5 animate-pulse" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        Pair Real WhatsApp Account
                      </h3>
                      <p className="text-xs text-slate-400">
                        Official Baileys multi-device pairing for any phone number worldwide
                      </p>
                    </div>
                  </div>

                  {/* Mode Toggle */}
                  <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
                    <button
                      onClick={() => setPairingMode('code')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                        pairingMode === 'code'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Pairing Code</span>
                    </button>
                    <button
                      onClick={() => setPairingMode('qr')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                        pairingMode === 'qr'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>QR Code</span>
                    </button>
                  </div>
                </div>

                {/* Already Connected State */}
                {status.isConnected ? (
                  <div className="mt-6 p-6 rounded-2xl bg-emerald-950/20 border border-emerald-500/30 text-center space-y-4">
                    <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                      <CheckCircle2 className="w-8 h-8" />
                    </div>
                    <div>
                      <h4 className="text-lg font-bold text-white">Your WhatsApp is Linked & Active!</h4>
                      <p className="text-xs text-emerald-300/80 mt-1">
                        SOLVATECH engine is connected to your WhatsApp number. You can now use all 35+ commands directly inside WhatsApp!
                      </p>
                      <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-emerald-500/30 font-mono text-xs text-emerald-300">
                        <span>Connected Phone: {status.user?.phone || status.user?.id}</span>
                      </div>
                    </div>

                    <div className="flex justify-center gap-3 pt-2">
                      <button
                        onClick={handleLogoutWhatsApp}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 text-xs font-semibold transition-all"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Unlink / Disconnect Session</span>
                      </button>
                    </div>
                  </div>
                ) : pairingMode === 'code' ? (
                  /* Pairing Code Form */
                  <form onSubmit={handleRequestPairingCode} className="mt-6 space-y-5">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-2">
                        Select Country (All Countries in the World)
                      </label>
                      <CountrySelect
                        selectedCountry={selectedCountry}
                        onSelect={(c) => setSelectedCountry(c)}
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-slate-300">
                          Your WhatsApp Phone Number
                        </label>
                        <span className="text-[11px] text-slate-500">
                          Format: e.g. {selectedCountry.format || '8012345678'}
                        </span>
                      </div>

                      <div className="relative flex rounded-xl border border-slate-700 bg-slate-900 overflow-hidden focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all">
                        <div className="flex items-center px-3.5 bg-slate-800/80 text-emerald-400 font-mono font-semibold text-sm border-r border-slate-700">
                          {selectedCountry.dialCode}
                        </div>
                        <input
                          type="tel"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          placeholder={selectedCountry.format || 'Enter phone number'}
                          className="flex-1 bg-transparent px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none font-mono"
                          required
                        />
                      </div>

                      {fullCleanPhone && (
                        <p className="mt-1.5 text-[11px] text-emerald-400/80 font-mono">
                          Target WhatsApp JID: {fullCleanPhone}
                        </p>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={loading || !phoneNumber}
                      className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-950/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {loading ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Requesting Pairing Code from WhatsApp...</span>
                        </>
                      ) : (
                        <>
                          <KeyRound className="w-4 h-4 text-slate-950" />
                          <span>Get WhatsApp 8-Digit Pairing Code</span>
                        </>
                      )}
                    </button>

                    {/* Active Pairing Code Display */}
                    {pairingCode && (
                      <div className="mt-5 p-5 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-emerald-500/40 shadow-inner">
                        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                          <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4" />
                            Code Ready for {status.targetPhone || fullCleanPhone}
                          </span>
                          <span className="font-mono text-slate-400">
                            Expires in: <strong className="text-white">{countdown}s</strong>
                          </span>
                        </div>

                        {/* Giant Pairing Code */}
                        <div className="flex items-center justify-center gap-3 py-4 my-2 rounded-xl bg-slate-950 border border-slate-800">
                          <span className="font-mono text-3xl sm:text-4xl font-extrabold tracking-widest text-emerald-400 select-all">
                            {pairingCode}
                          </span>
                          <button
                            type="button"
                            onClick={handleCopyCode}
                            className="p-2.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-all border border-emerald-500/30"
                            title="Copy Pairing Code"
                          >
                            {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                          </button>
                        </div>

                        {/* Instructions */}
                        <div className="mt-3 text-xs text-slate-300 space-y-1.5 bg-slate-900/60 p-3 rounded-xl border border-slate-800/80">
                          <p className="font-semibold text-white">How to pair on your WhatsApp app:</p>
                          <ol className="list-decimal list-inside space-y-1 text-slate-400">
                            <li>Open WhatsApp on your mobile phone</li>
                            <li>Go to <strong className="text-slate-200">Settings</strong> (iOS) or <strong className="text-slate-200">⋮ Menu</strong> (Android)</li>
                            <li>Tap <strong className="text-slate-200">Linked Devices</strong> → <strong className="text-slate-200">Link a Device</strong></li>
                            <li>Tap <strong className="text-emerald-400">Link with phone number instead</strong></li>
                            <li>Enter the code above: <strong className="text-emerald-400 font-mono">{pairingCode}</strong></li>
                          </ol>
                        </div>
                      </div>
                    )}
                  </form>
                ) : (
                  /* QR Code Fallback */
                  <div className="mt-6 flex flex-col items-center justify-center p-6 text-center space-y-4">
                    {status.qrCodeUrl ? (
                      <div className="p-3 bg-white rounded-2xl shadow-xl">
                        <img
                          src={status.qrCodeUrl}
                          alt="WhatsApp Baileys QR Code"
                          className="w-52 h-52 object-contain"
                        />
                      </div>
                    ) : (
                      <div className="w-52 h-52 rounded-2xl border-2 border-dashed border-slate-700 flex flex-col items-center justify-center p-4 text-slate-500">
                        <QrCode className="w-12 h-12 mb-2 opacity-40" />
                        <p className="text-xs">
                          {loading
                            ? 'Generating WhatsApp QR Code...'
                            : 'Enter phone number and request code or click to generate QR'}
                        </p>
                      </div>
                    )}
                    <p className="text-xs text-slate-400 max-w-sm">
                      Open WhatsApp → Linked Devices → Link a Device → Scan this QR code with your phone camera.
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  End-to-End Encrypted Baileys Multi-Device Socket
                </span>
                <span>All 240+ Countries Supported</span>
              </div>
            </div>

            {/* Right Column: Outbound Message & Quick Notifications */}
            <div className="lg:col-span-5 space-y-6">
              {/* Test Message Card */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-teal-500/10 text-teal-400">
                      <Send className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-white">Send Test WhatsApp Message</h4>
                      <p className="text-[11px] text-slate-400">Test outbound message from your linked WhatsApp</p>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleSendTestMessage} className="mt-4 space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Recipient Number (with country code)
                    </label>
                    <input
                      type="tel"
                      placeholder="e.g. 2348012345678"
                      value={testToPhone}
                      onChange={(e) => setTestToPhone(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Message Content
                    </label>
                    <textarea
                      rows={2}
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={sendingTest || !status.isConnected}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs border border-slate-700 disabled:opacity-40 transition-all"
                  >
                    {sendingTest ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    <span>{status.isConnected ? 'Send via WhatsApp' : 'Link WhatsApp to Send'}</span>
                  </button>

                  {testResult && (
                    <p className="text-[11px] p-2 rounded-lg bg-slate-900 border border-slate-800 text-emerald-400 font-medium">
                      {testResult}
                    </p>
                  )}
                </form>
              </div>

              {/* Live Events Stream */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                      <Bell className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-white">Live WhatsApp Feed</h4>
                      <p className="text-[11px] text-slate-400">Incoming messages & anti-delete logs</p>
                    </div>
                  </div>

                  <button
                    onClick={() => setIsNotifOpen(true)}
                    className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1"
                  >
                    <span>View All ({notifications.length})</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>

                <div className="mt-3 space-y-2 max-h-56 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">
                      No WhatsApp activity yet. Link your number to see live events.
                    </p>
                  ) : (
                    notifications.slice(0, 3).map((n) => (
                      <div
                        key={n.id}
                        className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs"
                      >
                        <div className="flex items-center justify-between text-slate-300 font-medium">
                          <span className="truncate text-white">{n.title}</span>
                          <span className="text-[10px] text-slate-500 font-mono">{n.timestamp}</span>
                        </div>
                        <p className="text-slate-400 mt-0.5 line-clamp-2 text-[11px]">{n.body}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: COMMAND DIRECTORY (35+) */}
        {activeTab === 'commands' && (
          <CommandDirectory onRunCommand={handleRunCommandFromDirectory} />
        )}

        {/* TAB 3: PREVIEW TERMINAL */}
        {activeTab === 'terminal' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8">
              <ChatSimulator
                initialCommand={commandToRun}
                onClearInitialCommand={() => setCommandToRun(undefined)}
              />
            </div>
            <div className="lg:col-span-4 space-y-4">
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-xl text-xs space-y-3">
                <h4 className="font-bold text-white text-sm flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  Test Any Command
                </h4>
                <p className="text-slate-400 text-[11px]">
                  Click any command to preview what SOLVATECH will respond when someone types it in WhatsApp:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {['.menu', '.ping', '.uptime', '.owner', '.expire', '.ai What is AI?', '.anti', '.open', '.sticker', '.warn @2348011223344'].map((cmd) => (
                    <button
                      key={cmd}
                      onClick={() => setCommandToRun(cmd)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-emerald-400 font-mono text-[11px] transition-colors"
                    >
                      {cmd}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-xl text-xs space-y-2">
                <div className="flex items-center gap-2 text-rose-400 font-bold">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Real WhatsApp Response Mode</span>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Remember: In production, you type these directly in your WhatsApp conversations. The bot will automatically reply in WhatsApp!
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Notifications Drawer */}
      <NotificationsPanel
        isOpen={isNotifOpen}
        onClose={() => setIsNotifOpen(false)}
        notifications={notifications}
        onClear={handleClearNotifications}
      />

      {/* Auth Modal for Google Sign-In */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onSuccess={(user) => {
          setCurrentUser(user);
          setIsAuthModalOpen(false);
        }}
        onClose={() => setIsAuthModalOpen(false)}
      />

      {/* AI Image Generation Studio Modal */}
      <ImageGeneratorModal
        isOpen={isImageModalOpen}
        onClose={() => setIsImageModalOpen(false)}
      />

      {/* Railway 24/7 Deployment Guide Modal */}
      <RailwayGuideModal
        isOpen={isRailwayModalOpen}
        onClose={() => setIsRailwayModalOpen(false)}
      />
    </div>
  );
}
