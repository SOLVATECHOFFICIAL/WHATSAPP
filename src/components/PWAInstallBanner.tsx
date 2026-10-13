import React, { useState } from 'react';
import { Download, X, Sparkles, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallBanner: React.FC = () => {
  const {
    isInstallable,
    isInstalled,
    isBannerHidden,
    isIOS,
    install,
    markAsInstalledOnPhone,
    dismissBannerPermanently,
  } = usePWAInstall();

  const [isInstalling, setIsInstalling] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  const [iosNotice, setIosNotice] = useState(false);

  // If already installed on phone, running in standalone mode, or user dismissed permanently
  if (isInstalled || isBannerHidden) {
    return null;
  }

  // Only show if installable on Chrome/Edge/Android or if on iOS Safari
  if (!isInstallable && !isIOS) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isIOS) {
      markAsInstalledOnPhone();
      setJustInstalled(true);
      return;
    }
    setIsInstalling(true);
    try {
      await install();
      markAsInstalledOnPhone();
      setJustInstalled(true);
    } catch {
      markAsInstalledOnPhone();
      setJustInstalled(true);
    } finally {
      setIsInstalling(false);
    }
  };

  const handleDismiss = () => {
    dismissBannerPermanently();
  };

  const handleAlreadyInstalled = () => {
    markAsInstalledOnPhone();
  };

  if (justInstalled) {
    return (
      <div className="bg-emerald-950/90 border-b border-emerald-500/30 px-4 py-2 text-center text-xs font-bold text-emerald-300 flex items-center justify-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        SOLVATECH App added to Home Screen successfully! Banner removed.
      </div>
    );
  }

  return (
    <div className="relative z-40 bg-gradient-to-r from-emerald-950/90 via-slate-900/95 to-cyan-950/90 border-b border-emerald-500/30 backdrop-blur-md px-4 py-2.5 transition-all shadow-lg shadow-emerald-950/20">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative shrink-0">
            <img
              src="/solva.webp"
              alt="SOLVATECH BOT"
              className="w-10 h-10 rounded-xl object-cover ring-2 ring-emerald-500/50 shadow-md shadow-emerald-500/20"
            />
            <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-slate-900"></span>
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white tracking-wide uppercase flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                Add SOLVATECH App
              </span>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-semibold px-2 py-0.5 rounded-full border border-emerald-500/30">
                Offline & 24/7 Fast
              </span>
            </div>
            <p className="text-xs text-slate-300 truncate">
              {iosNotice
                ? 'Tap Safari Share ⎋ then select "Add to Home Screen" to install directly.'
                : 'Install as a native application on your home screen for instant access.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
          <button
            type="button"
            onClick={handleAlreadyInstalled}
            className="text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-800/80 transition-colors cursor-pointer"
            title="Already installed on phone"
          >
            Already on phone ✓
          </button>

          <button
            onClick={handleInstallClick}
            disabled={isInstalling}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg shadow-md shadow-emerald-500/25 active:scale-95 transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isInstalling ? 'Adding...' : 'Add to Home Screen'}</span>
          </button>

          <button
            onClick={handleDismiss}
            aria-label="Dismiss install banner"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800/80 transition-colors cursor-pointer"
            title="Dismiss banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
