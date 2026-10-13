import React, { useState } from 'react';
import {
  X,
  CreditCard,
  Copy,
  Check,
  Key,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import {
  LICENSE_PLANS,
  PAYMENT_INFO,
  redeemKey,
  checkUserTrialStatus,
  claim30MinuteTrial,
} from '../services/license';

interface PricingModalProps {
  isOpen: boolean;
  userUid?: string;
  userEmail?: string | null;
  onClose: () => void;
  onLicenseActivated?: (planName: string, expiresAt?: string) => void;
}

export const PricingModal: React.FC<PricingModalProps> = ({
  isOpen,
  userUid,
  userEmail,
  onClose,
  onLicenseActivated,
}) => {
  const [copiedAccount, setCopiedAccount] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemSuccess, setRedeemSuccess] = useState<string | null>(null);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  const [hasClaimedTrial, setHasClaimedTrial] = useState(false);
  const [claimingTrial, setClaimingTrial] = useState(false);
  const [trialMessage, setTrialMessage] = useState<string | null>(null);

  React.useEffect(() => {
    if (userUid) {
      checkUserTrialStatus(userUid, userEmail).then(setHasClaimedTrial);
    }
  }, [userUid, userEmail, isOpen]);

  const handleClaimTrial = async () => {
    if (!userUid || !userEmail) {
      setTrialMessage('Please sign in to claim your 30-minute test.');
      return;
    }
    setClaimingTrial(true);
    setTrialMessage(null);
    try {
      const res = await claim30MinuteTrial(userUid, userEmail);
      if (res.success) {
        setHasClaimedTrial(true);
        setTrialMessage(res.message);
        if (onLicenseActivated) {
          onLicenseActivated('⚡ 30-Minute Free Test (Active)', res.expiresAt);
        }
      } else {
        setTrialMessage(res.message);
        setHasClaimedTrial(true);
      }
    } catch (err: any) {
      setTrialMessage(err.message || 'Error activating 30-minute test');
    } finally {
      setClaimingTrial(false);
    }
  };

  if (!isOpen) return null;

  const handleCopyAccount = () => {
    navigator.clipboard.writeText(PAYMENT_INFO.accountNumber);
    setCopiedAccount(true);
    setTimeout(() => setCopiedAccount(false), 2000);
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim() || redeeming) return;
    if (!userUid || !userEmail) {
      setRedeemError('Please sign in with your account before redeeming a license key.');
      return;
    }

    setRedeeming(true);
    setRedeemSuccess(null);
    setRedeemError(null);

    try {
      const res = await redeemKey(
        userUid,
        userEmail,
        keyInput
      );
      if (res.success) {
        setRedeemSuccess(res.message);
        setKeyInput('');
        if (onLicenseActivated) {
          onLicenseActivated('Active Plan', res.expiresAt);
        }
      } else {
        setRedeemError(res.message);
      }
    } catch (err: any) {
      setRedeemError(err.message || 'Error redeeming license key');
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Top Header */}
        <div className="p-5 border-b border-slate-800 bg-gradient-to-b from-slate-800/40 to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/solva.webp"
              alt="SOLVATECH"
              className="w-10 h-10 rounded-xl object-cover ring-1 ring-emerald-500/40 shadow-md shrink-0"
            />
            <div>
              <h3 className="font-bold text-white text-base">SOLVATECH BOT License Plans</h3>
              <p className="text-xs text-slate-400">Official Pricing & Instant Key Activation</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* 30-Minute Free Test Card - Only shown if never claimed in this account */}
          {!hasClaimedTrial && (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/50 via-slate-900 to-emerald-950/40 border border-amber-500/40 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 font-bold">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-white text-xs sm:text-sm">🎁 30-Minute Free Test</h4>
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-bold uppercase tracking-wider">
                        Once in a Lifetime
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      Test all bot commands, Anti-Delete, and group defense free for 30 minutes!
                    </p>
                  </div>
                </div>
              </div>

              {trialMessage && (
                <div className="p-2 rounded-xl bg-slate-950 border border-amber-500/40 text-amber-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>{trialMessage}</span>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800">
                <span className="text-[10px] text-slate-400">
                  Free access: No payment needed
                </span>
                <button
                  type="button"
                  onClick={handleClaimTrial}
                  disabled={claimingTrial}
                  className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-emerald-400 hover:from-amber-400 hover:to-emerald-300 text-slate-950 font-bold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50"
                >
                  {claimingTrial ? 'Activating...' : 'Activate 30-Min Test Free'}
                </button>
              </div>
            </div>
          )}

          {/* Key Activation Form Card */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/30 to-slate-950 border border-emerald-500/30 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <h4 className="font-bold text-white text-xs sm:text-sm">Have a License Key? Activate Now</h4>
            </div>

            <form onSubmit={handleRedeem} className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. SOLVA-7D-A1B2-C3D4"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono tracking-wider"
              />
              <button
                type="submit"
                disabled={redeeming || !keyInput.trim()}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs shadow-md transition-all disabled:opacity-50 shrink-0"
              >
                {redeeming ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Activate Key'}
              </button>
            </form>

            {redeemSuccess && (
              <div className="p-2.5 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{redeemSuccess}</span>
              </div>
            )}

            {redeemError && (
              <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/40 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{redeemError}</span>
              </div>
            )}

            {/* Single-Use License Security Notice */}
            <div className="pt-2 border-t border-slate-800/80">
              <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Each license key is single-use and unique. Keys are issued directly upon payment confirmation.</span>
              </p>
            </div>
          </div>

          {/* Formatted License Plans List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-white text-xs uppercase tracking-wider text-emerald-400">
                ⚔️ SOLVATECH BOT — LICENSE PLANS ⚔️
              </h4>
              <span className="text-[11px] text-slate-500">Pick your duration</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {LICENSE_PLANS.map((plan) => (
                <div
                  key={plan.id}
                  className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between hover:border-slate-700 transition-colors"
                >
                  <span className="text-slate-300 font-medium">
                    • {plan.name}
                  </span>
                  <span className="font-mono font-extrabold text-emerald-400">
                    {plan.priceFormatted}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Prominent OPay Payment Showcase */}
          <div className="p-5 rounded-3xl bg-gradient-to-br from-emerald-950 via-slate-900 to-teal-950 border-2 border-emerald-400/80 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-emerald-500/30 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-400 to-cyan-400 flex items-center justify-center font-black text-slate-950 text-lg shadow-md shadow-emerald-500/30">
                  OP
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h4 className="font-black text-sm text-white tracking-wide">
                      OPay Bank
                    </h4>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 font-bold text-[9px] uppercase">
                      Official
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-300/80 font-medium">
                    OPay Microfinance Bank / PayCom
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 px-2 py-0.5 rounded-lg bg-slate-950 border border-emerald-500/40 font-bold">
                Instant Credit
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950/90 border border-emerald-500/40 text-center space-y-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                OPAY ACCOUNT NUMBER
              </span>
              <div className="flex items-center justify-center gap-3">
                <span className="font-mono text-2xl sm:text-3xl font-black text-emerald-400 tracking-widest select-all">
                  {PAYMENT_INFO.accountNumber}
                </span>
                <button
                  type="button"
                  onClick={handleCopyAccount}
                  className="p-2 rounded-xl bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-all font-bold flex items-center gap-1"
                  title="Copy Account Number"
                >
                  {copiedAccount ? <Check className="w-4 h-4 stroke-[3]" /> : <Copy className="w-4 h-4" />}
                  <span className="text-xs">{copiedAccount ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Account Name</span>
                <strong className="text-white font-bold block truncate mt-0.5">
                  {PAYMENT_INFO.accountName}
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Bank Name</span>
                <strong className="text-emerald-300 font-bold block truncate mt-0.5">
                  OPay (PayCom)
                </strong>
              </div>
            </div>

            <a
              href={PAYMENT_INFO.whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs transition-all shadow-lg active:scale-[0.98]"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Send Payment Proof to Solomon on WhatsApp</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
