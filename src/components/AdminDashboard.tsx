import React, { useState, useEffect } from 'react';
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
  Flame,
  CheckCircle2,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  Zap,
  Lock
} from 'lucide-react';
import {
  LICENSE_PLANS,
  PAYMENT_INFO,
  LicensePlan,
  LicenseRecord,
  SPECIAL_5D_KEYS,
  createLicense,
  fetchAllLicenses,
  fetchAllUsers,
  toggleUserUnlimited,
  grantUserUnlimitedByIdentifier,
  OWNER_EMAIL
} from '../services/license';

interface AdminDashboardProps {
  currentUserEmail?: string | null;
  onClose: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ currentUserEmail, onClose }) => {
  const [selectedPlan, setSelectedPlan] = useState<LicensePlan>(LICENSE_PLANS[0]); // default 1 Day
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<LicenseRecord | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'generator' | 'users' | 'inventory' | 'special'>('generator');
  const [togglingUid, setTogglingUid] = useState<string | null>(null);

  // New grant VIP input state
  const [grantEmailInput, setGrantEmailInput] = useState('');
  const [granting, setGranting] = useState(false);
  const [grantFeedback, setGrantFeedback] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [allLic, allUsr] = await Promise.all([
        fetchAllLicenses(),
        fetchAllUsers(),
      ]);
      setLicenses(allLic);
      setUsers(allUsr);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateKey = async () => {
    setGenerating(true);
    try {
      const newLicense = await createLicense(selectedPlan, currentUserEmail || OWNER_EMAIL);
      setGeneratedKey(newLicense);
      setLicenses((prev) => [newLicense, ...prev]);
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  };

  const copyKeyText = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const copyWhatsAppReceipt = () => {
    if (!generatedKey) return;
    const msg = `🎉 *SOLVATECH BOT — LICENSE KEY ISSUED* 🎉\n\n🔑 *Plan:* ${generatedKey.planName}\n⏳ *Duration:* ${generatedKey.durationDays} Days\n🔐 *License Key:*\n\`${generatedKey.key}\`\n\n👉 *How to activate:*\n1. Open your SOLVATECH Portal\n2. Click "Redeem License"\n3. Paste your key above and enjoy 24/7 automated bot actions!`;
    navigator.clipboard.writeText(msg);
    setCopiedMessage(true);
    setTimeout(() => setCopiedMessage(false), 2000);
  };

  // TOGGLE UNLIMITED SWITCH FOR A USER
  const handleToggleUnlimited = async (user: any) => {
    const newStatus = !user.isUnlimited;
    setTogglingUid(user.uid);
    try {
      await toggleUserUnlimited(user.uid, user.email || 'user@solvatech.com', newStatus);
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === user.uid
            ? {
                ...u,
                isUnlimited: newStatus,
                licenseStatus: newStatus ? 'unlimited' : 'expired',
                licensePlan: newStatus ? '👑 Unlimited Lifetime (Admin Granted)' : 'Expired Plan',
              }
            : u
        )
      );
    } catch (err) {
      console.error('Toggle error:', err);
    } finally {
      setTogglingUid(null);
    }
  };

  const handleGrantQuickUnlimited = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = grantEmailInput.trim();
    if (!clean || granting) return;
    setGranting(true);
    setGrantFeedback(null);
    try {
      const res = await grantUserUnlimitedByIdentifier(clean, true);
      if (res.success) {
        setGrantFeedback(`Granted Unlimited to ${clean}!`);
        setGrantEmailInput('');
        setUsers((prev) => {
          const idx = prev.findIndex((u) => u.email === res.user.email || u.uid === res.user.uid);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = res.user;
            return next;
          }
          return [res.user, ...prev];
        });
      }
    } catch (err: any) {
      setGrantFeedback(`Error: ${err?.message || 'Failed'}`);
    } finally {
      setGranting(false);
    }
  };

  const query = (searchQuery || '').trim().toLowerCase();
  const filteredLicenses = (licenses || []).filter((l) => {
    if (!l) return false;
    const keyStr = String(l.key || '').toLowerCase();
    const planStr = String(l.planName || '').toLowerCase();
    const emailStr = String(l.claimedEmail || '').toLowerCase();
    return (
      keyStr.includes(query) ||
      planStr.includes(query) ||
      emailStr.includes(query)
    );
  });

  const filteredUsers = (users || []).filter((u) => {
    if (!u) return false;
    if (!query) return true;
    const emailStr = String(u.email || '').toLowerCase();
    const nameStr = String(u.displayName || '').toLowerCase();
    const planStr = String(u.licensePlan || '').toLowerCase();
    return emailStr.includes(query) || nameStr.includes(query) || planStr.includes(query);
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Top Header */}
        <div className="p-5 border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-400 text-slate-950 flex items-center justify-center font-bold shadow-lg shadow-amber-950/40">
              <Shield className="w-5 h-5 font-black" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base">SOLVATECH Admin Management</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  OWNER CONTROL
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Key Generator • Unlimited User Switches • Pre-seeded 5-Day Keys
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              title="Refresh Data"
              className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Master Owner Banner */}
        <div className="px-6 py-3 bg-amber-950/30 border-b border-amber-500/20 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-amber-300">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Master Account: <strong>Solomon Oladimeji ({OWNER_EMAIL})</strong></span>
          </div>
          <div className="flex items-center gap-3 text-slate-300 font-mono text-[11px]">
            <span>Master Key: <strong className="text-emerald-400">SOLVA-OWNER-UNLIMITED-MASTER</strong></span>
            <span>•</span>
            <span>OPay: <strong className="text-white">{PAYMENT_INFO.accountNumber}</strong></span>
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="px-6 pt-3 flex gap-2 border-b border-slate-800 bg-slate-950/50 text-xs font-semibold overflow-x-auto">
          <button
            onClick={() => setActiveTab('generator')}
            className={`flex items-center gap-1.5 px-4 py-2 border-b-2 transition-all shrink-0 ${
              activeTab === 'generator'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>Generate Keys</span>
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-1.5 px-4 py-2 border-b-2 transition-all shrink-0 ${
              activeTab === 'users'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Users & Unlimited Switch ({users.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('special')}
            className={`flex items-center gap-1.5 px-4 py-2 border-b-2 transition-all shrink-0 ${
              activeTab === 'special'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>5-Day Special Keys ({SPECIAL_5D_KEYS.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('inventory')}
            className={`flex items-center gap-1.5 px-4 py-2 border-b-2 transition-all shrink-0 ${
              activeTab === 'inventory'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Inventory ({licenses.length})</span>
          </button>
        </div>

        {/* Main Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: GENERATE KEYS */}
          {activeTab === 'generator' && (
            <div className="space-y-6">
              <div>
                <h4 className="text-sm font-bold text-white mb-1">Select License Duration to Issue</h4>
                <p className="text-xs text-slate-400">
                  Choose a customer's plan duration to instantly generate an authentic key synced to Firebase:
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-3">
                  {LICENSE_PLANS.map((plan) => {
                    const isSelected = selectedPlan.id === plan.id;
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => setSelectedPlan(plan)}
                        className={`p-3 rounded-2xl border text-left transition-all ${
                          isSelected
                            ? 'bg-emerald-950/40 border-emerald-500 text-white shadow-md'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs">{plan.name}</span>
                          <span className="text-xs font-mono font-extrabold text-emerald-400">
                            {plan.priceFormatted}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {plan.durationDays} Days of Bot Access
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Generate Action Button */}
              <div>
                <button
                  type="button"
                  onClick={handleGenerateKey}
                  disabled={generating}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-bold text-xs shadow-lg transition-all disabled:opacity-50"
                >
                  {generating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Writing License to Firebase...</span>
                    </>
                  ) : (
                    <>
                      <PlusCircle className="w-4 h-4" />
                      <span>Generate Key for {selectedPlan.name} ({selectedPlan.priceFormatted})</span>
                    </>
                  )}
                </button>
              </div>

              {/* Generated Key Result Display */}
              {generatedKey && (
                <div className="p-5 rounded-2xl bg-gradient-to-b from-slate-950 to-slate-900 border border-emerald-500/50 shadow-xl space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      License Generated & Synced to Firebase
                    </span>
                    <span className="font-mono text-slate-400">
                      Duration: <strong className="text-white">{generatedKey.durationDays} Days</strong>
                    </span>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
                    <code className="text-base sm:text-lg font-mono font-extrabold text-emerald-400 tracking-wider select-all">
                      {generatedKey.key}
                    </code>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => copyKeyText(generatedKey.key)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-xs font-semibold border border-emerald-500/30"
                      >
                        {copiedKey === generatedKey.key ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === generatedKey.key ? 'Copied' : 'Copy Key'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={copyWhatsAppReceipt}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
                        title="Copy full formatted WhatsApp message for customer"
                      >
                        {copiedMessage ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <ExternalLink className="w-3.5 h-3.5" />}
                        <span>{copiedMessage ? 'Copied WhatsApp Msg' : 'WhatsApp Receipt'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: USERS & UNLIMITED SWITCH */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-amber-950/20 border border-amber-500/30 text-xs text-amber-300 flex items-start gap-2.5">
                <Zap className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                <div>
                  <span className="font-bold">Instant Unlimited Switch:</span>
                  <p className="text-[11px] text-amber-300/80 mt-0.5">
                    Toggle Unlimited ON for VIP users. They get lifetime bot access without ever needing a key again. They do NOT get access to this Admin dashboard. If you toggle it OFF, their access disconnects immediately.
                  </p>
                </div>
              </div>

              {/* Quick Grant VIP User Form */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    Quick Grant / Add VIP User Unlimited
                  </span>
                  <span className="text-[10px] text-slate-500">Admin Privileged</span>
                </div>
                <form onSubmit={handleGrantQuickUnlimited} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter user email or phone (e.g. client@gmail.com)"
                    value={grantEmailInput}
                    onChange={(e) => setGrantEmailInput(e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 font-mono"
                  />
                  <button
                    type="submit"
                    disabled={granting || !grantEmailInput.trim()}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 text-slate-950 font-bold text-xs transition-all disabled:opacity-50 shrink-0"
                  >
                    {granting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Grant Unlimited (ON)'}
                  </button>
                </form>
                {grantFeedback && (
                  <p className="text-[11px] text-emerald-400 font-medium">{grantFeedback}</p>
                )}
              </div>

              {/* User search & Count */}
              <div className="flex items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search users by name, email or plan..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  Showing: {filteredUsers.length} users
                </span>
              </div>

              <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950">
                <table className="w-full text-left text-xs text-slate-300 divide-y divide-slate-800">
                  <thead className="bg-slate-900/60 text-slate-400 font-semibold text-[11px]">
                    <tr>
                      <th className="p-3">User Account</th>
                      <th className="p-3">Email</th>
                      <th className="p-3">License Plan</th>
                      <th className="p-3 text-center">Unlimited Switch</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-6 text-center text-slate-500">
                          No users found matching query.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u, i) => {
                        const isMasterOwner = u?.email === OWNER_EMAIL || u?.uid === 'owner_master';
                        const isUnl = u?.isUnlimited || isMasterOwner;
                        const initial = (u?.displayName || u?.email || 'U')[0]?.toUpperCase() || 'U';

                        return (
                          <tr key={u?.uid || i} className="hover:bg-slate-900/40 transition-colors">
                            <td className="p-3 font-semibold text-white flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center text-xs text-white font-bold">
                                {initial}
                              </div>
                              <div>
                                <p className="leading-tight">{u?.displayName || 'Solvatech User'}</p>
                                {isMasterOwner && (
                                  <span className="text-[10px] text-amber-400 font-bold">👑 Master Admin</span>
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-slate-400">{u?.email || '—'}</td>
                            <td className="p-3 font-mono text-[11px]">
                              {isUnl ? (
                                <span className="text-amber-300 font-bold">👑 UNLIMITED LIFETIME</span>
                              ) : (
                                <span className="text-emerald-400">{u?.licensePlan || 'Free / Expired'}</span>
                              )}
                            </td>
                            <td className="p-3 text-center">
                              {isMasterOwner ? (
                                <span className="px-2 py-1 rounded-lg bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/30">
                                  OWNER FOREVER
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={togglingUid === u?.uid}
                                  onClick={() => handleToggleUnlimited(u)}
                                  className={`px-3 py-1.5 rounded-xl font-bold text-[11px] transition-all flex items-center gap-1.5 mx-auto ${
                                    isUnl
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/40'
                                      : 'bg-slate-800 text-slate-400 hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/40 border border-slate-700'
                                  }`}
                                >
                                  {isUnl ? (
                                    <>
                                      <ToggleRight className="w-4 h-4 text-amber-400" />
                                      <span>Unlimited: ON</span>
                                    </>
                                  ) : (
                                    <>
                                      <ToggleLeft className="w-4 h-4 text-slate-500" />
                                      <span>Unlimited: OFF</span>
                                    </>
                                  )}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: 5-DAY SPECIAL PRE-SEEDED KEYS */}
          {activeTab === 'special' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-emerald-950/20 border border-emerald-500/30 text-xs text-emerald-300 flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                <div>
                  <span className="font-bold">5 Special Pre-Seeded 5-Day Keys</span>
                  <p className="text-[11px] text-emerald-300/80 mt-0.5">
                    These are verified keys already recognized by the system. Any customer who enters these keys will receive 5 full days of bot access immediately!
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SPECIAL_5D_KEYS.map((k) => (
                  <div
                    key={k.key}
                    className="p-4 rounded-2xl bg-slate-950 border border-slate-800 hover:border-slate-700 transition-colors flex items-center justify-between gap-2"
                  >
                    <div>
                      <code className="text-xs font-mono font-extrabold text-emerald-400 select-all">
                        {k.key}
                      </code>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Duration: 5 Days (₦750 Value)
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => copyKeyText(k.key)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all shrink-0"
                    >
                      {copiedKey === k.key ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey === k.key ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: ACTIVE KEYS INVENTORY */}
          {activeTab === 'inventory' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search by key, plan or user email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  Total: {filteredLicenses.length} keys
                </span>
              </div>

              <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950">
                <table className="w-full text-left text-xs text-slate-300 divide-y divide-slate-800">
                  <thead className="bg-slate-900/60 text-slate-400 font-semibold text-[11px]">
                    <tr>
                      <th className="p-3">License Key</th>
                      <th className="p-3">Plan</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Claimed By</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {filteredLicenses.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-slate-500 font-sans">
                          No license keys found matching search.
                        </td>
                      </tr>
                    ) : (
                      filteredLicenses.map((lic, idx) => (
                        <tr key={lic?.key || idx} className="hover:bg-slate-900/40 transition-colors">
                          <td className="p-3 font-bold text-emerald-400">{lic?.key || 'SOLVA-KEY'}</td>
                          <td className="p-3 font-sans">{lic?.planName || 'Standard Plan'}</td>
                          <td className="p-3 font-sans">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                lic?.status === 'unclaimed'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : lic?.status === 'active'
                                  ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              }`}
                            >
                              {(lic?.status || 'unclaimed').toUpperCase()}
                            </span>
                          </td>
                          <td className="p-3 text-slate-400 font-sans truncate max-w-[150px]">
                            {lic?.claimedEmail || '—'}
                          </td>
                          <td className="p-3">
                            <button
                              onClick={() => copyKeyText(lic.key)}
                              className="p-1 hover:text-emerald-400 transition-colors"
                              title="Copy Key"
                            >
                              {copiedKey === lic.key ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
