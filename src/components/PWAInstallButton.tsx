import React, { useState } from 'react';
import { Download, Smartphone, CheckCircle2, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{
  variant?: 'button' | 'banner';
}> = ({ variant = 'button' }) => {
  const {
    isInstalled,
    isBannerHidden,
    hasPrompt,
    isIOS,
    install,
    markAsInstalledOnPhone,
    dismissBannerPermanently,
  } = usePWAInstall();

  const [isPrompting, setIsPrompting] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  const [justDismissed, setJustDismissed] = useState(false);
  const [iosMessage, setIosMessage] = useState(false);

  // If already installed, banner dismissed, or no native prompt available (because app is already installed), hide completely!
  if (isInstalled || isBannerHidden || (!hasPrompt && !isIOS)) {
    return null;
  }

  const handleInstallClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isIOS || !hasPrompt) {
      markAsInstalledOnPhone();
      return;
    }

    setIsPrompting(true);
    try {
      await install();
      markAsInstalledOnPhone();
    } catch (err) {
      console.warn('Install handled:', err);
      markAsInstalledOnPhone();
    } finally {
      setIsPrompting(false);
    }
  };

  const handleAlreadyOnPhone = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    markAsInstalledOnPhone();
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dismissBannerPermanently();
  };

  if (justInstalled) {
    if (variant === 'button') {
      return (
        <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold px-2 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/40">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          <span>Installed ✓</span>
        </span>
      );
    }
    return (
      <div className="mb-4 flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-950/90 p-3 text-xs font-bold text-emerald-300 shadow-lg">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <span>SOLVATECH App is installed on your device! Banner removed.</span>
      </div>
    );
  }

  if (justDismissed) {
    return (
      <div className="mb-4 flex items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/90 p-3 text-xs font-semibold text-slate-300 shadow-md">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <span>App install banner removed permanently.</span>
      </div>
    );
  }

  // Banner mode: 1-click install with permanent "Already on my phone" dismissal
  if (variant === 'banner') {
    return (
      <div className="relative mb-4 overflow-hidden rounded-2xl border border-emerald-500/40 bg-gradient-to-r from-emerald-950/90 via-slate-900/95 to-cyan-950/90 p-3.5 shadow-xl backdrop-blur-md">
        {/* Dismiss 'X' button */}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss banner permanently"
          className="absolute top-2.5 right-2.5 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer"
          title="Dismiss banner"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pr-6 sm:pr-0">
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12 shrink-0 rounded-2xl overflow-hidden ring-2 ring-emerald-500/50 shadow-md bg-slate-900">
              <img src="/solva.webp" alt="SOLVATECH App" className="w-full h-full object-cover" />
              <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-slate-900"></span>
              </span>
            </div>
            <div className="text-left min-w-0">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 ring-1 ring-emerald-500/30">
                  <Smartphone className="w-3 h-3" /> Add to Home Screen
                </span>
                <span className="text-[10px] text-cyan-300 font-semibold bg-cyan-950/80 px-2 py-0.5 rounded-full border border-cyan-500/30">
                  Real Web App
                </span>
              </div>
              <h4 className="mt-1 font-bold text-white text-sm">Add SOLVATECH to Home Screen</h4>
              <p className="text-xs text-slate-300 mt-0.5">
                {iosMessage
                  ? 'Tap Safari Share ⎋ then tap "Add to Home Screen" to install instantly!'
                  : 'Install this application directly on your phone home screen for 24/7 access.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end shrink-0">
            <button
              type="button"
              onClick={handleAlreadyOnPhone}
              className="text-[11px] text-slate-400 hover:text-white px-2.5 py-2 rounded-xl hover:bg-slate-800/80 transition-colors font-medium cursor-pointer"
              title="Hide banner because you already installed it on your phone"
            >
              Already on my phone ✓
            </button>

            <button
              type="button"
              onClick={handleInstallClick}
              disabled={isPrompting}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-400 active:scale-95 transition cursor-pointer shrink-0"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>{isPrompting ? 'Adding...' : 'Add to Home Screen'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Header button mode: 1-click native install
  return (
    <div className="relative">
      <button
        onClick={handleInstallClick}
        disabled={isPrompting}
        className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-500/50 px-2.5 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 active:scale-95 transition shadow-sm shadow-emerald-500/10 cursor-pointer"
        title="Add SOLVATECH App to Home Screen"
      >
        <Download className="w-3.5 h-3.5 text-emerald-400 animate-bounce" />
        <span className="inline font-bold">{isPrompting ? 'Adding...' : 'Install App'}</span>
      </button>

      {iosMessage && (
        <div className="absolute right-0 top-full mt-2 w-64 p-2.5 bg-slate-900 border border-emerald-500/50 text-white text-[11px] rounded-xl shadow-xl z-50">
          Tap Safari Share icon ⎋ then tap <strong className="text-emerald-400">"Add to Home Screen"</strong>.
        </div>
      )}
    </div>
  );
};
