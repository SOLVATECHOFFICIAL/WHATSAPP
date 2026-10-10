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
  SPECIAL_5D_KEYS,
  redeemKey
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

  if (!isOpen) return null;

  const handleCopyAccount = () => {
    navigator.clipboard.writeText(PAYMENT_INFO.accountNumber);
    setCopiedAccount(true);
    setTimeout(() => setCopiedAccount(false), 2000);
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim() || redeeming) return;

    setRedeeming(true);
    setRedeemSuccess(null);
    setRedeemError(null);

    try {
      const res = await redeemKey(
        userUid || 'anonymous_user',
        userEmail || 'user@example.com',
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
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950 font-bold">
              <Key className="w-5 h-5 font-black" />
            </div>
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

            {/* 5-Day Special Keys Quick Fill */}
            <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
              <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-400" />
                5-Day VIP & Legacy Keys (Click to Fill):
              </span>
              <div className="flex flex-wrap gap-1">
                {SPECIAL_5D_KEYS.map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    onClick={() => setKeyInput(k.key)}
                    className="px-2 py-0.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-emerald-400 font-mono text-[10px] border border-slate-800 hover:border-emerald-500/30 transition-colors"
                  >
                    {k.key}
                  </button>
                ))}
              </div>
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

          {/* Payment Details Card */}
          <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-amber-400" />
                <h4 className="font-bold text-white text-xs uppercase tracking-wider">
                  💳 PAYMENT DETAILS (OPAY)
                </h4>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800/80 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Bank / FinTech:</span>
                <strong className="text-white font-mono">{PAYMENT_INFO.bank}</strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Account Number:</span>
                <div className="flex items-center gap-2">
                  <strong className="text-emerald-400 font-mono text-sm tracking-wide select-all">
                    {PAYMENT_INFO.accountNumber}
                  </strong>
                  <button
                    onClick={handleCopyAccount}
                    className="p-1 hover:text-emerald-400 transition-colors text-slate-400"
                    title="Copy Account Number"
                  >
                    {copiedAccount ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Account Name:</span>
                <strong className="text-white">{PAYMENT_INFO.accountName}</strong>
              </div>
            </div>

            {/* Note & WhatsApp Receipt Action */}
            <div className="text-xs text-slate-400 leading-relaxed space-y-2 pt-1">
              <p>
                📝 <strong className="text-white">Note:</strong> After payment, send your payment screenshot to Solomon on WhatsApp. Admin will immediately verify and send your license key!
              </p>

              <div className="pt-2 flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={handleCopyAccount}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs border border-slate-700 transition-all"
                >
                  {copiedAccount ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedAccount ? 'Copied Account!' : 'Copy OPay Account'}</span>
                </button>
                <a
                  href={PAYMENT_INFO.whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-bold text-xs shadow-md transition-all"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Send Receipt on WhatsApp</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
