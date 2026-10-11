import React, { useState } from 'react';
import { Download, X, Smartphone, Sparkles, Share, PlusSquare } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallBanner: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [isDismissed, setIsDismissed] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  // If already installed, running in standalone mode, or user dismissed for this session
  if (isInstalled || isDismissed) {
    return null;
  }

  // Only show if installable on Chrome/Edge/Android or if on iOS Safari
  if (!isInstallable && !isIOS) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSModal(true);
      return;
    }
    setIsInstalling(true);
    try {
      await install();
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <>
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
                  Install SOLVATECH App
                </span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-semibold px-2 py-0.5 rounded-full border border-emerald-500/30">
                  Offline & 24/7 Fast
                </span>
              </div>
              <p className="text-xs text-slate-300 truncate">
                Install as a native application for instant offline access and 24/7 background control!
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
            <button
              onClick={handleInstallClick}
              disabled={isInstalling}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg shadow-md shadow-emerald-500/25 active:scale-95 transition-all cursor-pointer"
            >
              {isIOS ? (
                <>
                  <Share className="w-3.5 h-3.5" />
                  Install on iPhone
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  {isInstalling ? 'Opening...' : 'Install App'}
                </>
              )}
            </button>

            <button
              onClick={() => setIsDismissed(true)}
              aria-label="Dismiss install banner"
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800/80 transition-colors"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* iOS Installation Instructions Modal */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-emerald-500/40 p-6 shadow-2xl text-slate-100">
            <div className="flex items-center gap-3 mb-4">
              <img
                src="/solva.webp"
                alt="SOLVATECH App"
                className="w-12 h-12 rounded-xl object-cover ring-2 ring-emerald-500/50 shadow-md"
              />
              <div>
                <h3 className="text-base font-bold text-white">Install on iPhone / iPad</h3>
                <p className="text-xs text-emerald-400">Add to Home Screen as Native App</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-slate-300 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0 text-[11px]">
                  1
                </span>
                <p>
                  Tap the <strong className="text-white">Share</strong> button{' '}
                  <Share className="inline w-3.5 h-3.5 text-blue-400" /> at the bottom of Safari.
                </p>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0 text-[11px]">
                  2
                </span>
                <p>
                  Scroll down the menu and tap{' '}
                  <strong className="text-white">Add to Home Screen</strong>{' '}
                  <PlusSquare className="inline w-3.5 h-3.5 text-emerald-400" />.
                </p>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0 text-[11px]">
                  3
                </span>
                <p>
                  Tap <strong className="text-white">Add</strong> in the top right corner. The app will launch with 24/7 full screen!
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowIOSModal(false)}
              className="mt-5 w-full rounded-xl bg-slate-800 hover:bg-slate-700 py-2.5 text-xs font-semibold text-white transition-colors"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
