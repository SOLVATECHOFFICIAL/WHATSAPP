import React, { useState } from 'react';
import { Download, Smartphone, X, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{
  variant?: 'button' | 'banner';
}> = ({ variant = 'button' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // If already installed in standalone mode, hide
  if (isInstalled || dismissed) {
    return null;
  }

  // Banner mode: Prompts user when browsing on Chrome / mobile to install if they don't have it
  if (variant === 'banner' && (isInstallable || isIOS)) {
    return (
      <>
        <div className="relative mb-6 overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/80 via-slate-900/90 to-slate-950/90 p-4 shadow-xl backdrop-blur-md">
          <button
            onClick={() => setDismissed(true)}
            className="absolute top-3 right-3 text-slate-400 hover:text-slate-200 transition"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="relative w-14 h-14 shrink-0 rounded-2xl overflow-hidden ring-2 ring-emerald-500/50 shadow-lg bg-slate-900">
              <img src="/solva.webp" alt="SOLVATECH App" className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/30">
                  <Smartphone className="w-3 h-3" /> Installable Web App
                </span>
              </div>
              <h4 className="mt-1 font-bold text-white text-base">Install SOLVATECH on your device</h4>
              <p className="text-xs text-slate-300 mt-0.5">
                Install as a standalone native app for instant 1-tap access, offline reliability, and fast background performance.
              </p>
            </div>
            <div className="shrink-0">
              {isInstallable ? (
                <button
                  onClick={install}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-400 active:scale-95 transition"
                >
                  <Download className="w-4 h-4" />
                  Install App
                </button>
              ) : isIOS ? (
                <button
                  onClick={() => setShowIOSGuide(true)}
                  className="flex items-center gap-2 rounded-xl bg-slate-800 border border-emerald-500/40 px-4 py-2.5 text-xs font-semibold text-emerald-300 hover:bg-slate-700 transition"
                >
                  <Download className="w-4 h-4" />
                  Install on iOS
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-emerald-500/30 bg-slate-900 p-6 shadow-2xl">
              <div className="flex items-center gap-3 mb-3">
                <img src="/solva.webp" alt="App Icon" className="w-10 h-10 rounded-xl object-cover ring-1 ring-emerald-500/40" />
                <div>
                  <h3 className="text-base font-bold text-white">Install on iPhone / iPad</h3>
                  <p className="text-xs text-emerald-400">Add to Home Screen</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-300">
                1. Tap the <strong className="text-white">Share</strong> button at the bottom of Safari.<br />
                2. Scroll down and select <strong className="text-white">Add to Home Screen</strong>.<br />
                3. Tap <strong className="text-white">Add</strong> in the top-right corner.
              </p>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-slate-800 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Header button mode
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 active:scale-95 transition"
        title="Install SOLVATECH App"
      >
        <Download className="w-3.5 h-3.5 text-emerald-400" />
        <span className="hidden sm:inline">Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 rounded-xl bg-slate-800/80 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-750 transition"
          title="Install on iOS"
        >
          <Download className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden sm:inline">Install App</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-emerald-500/30 bg-slate-900 p-6 shadow-2xl">
              <div className="flex items-center gap-3 mb-3">
                <img src="/solva.webp" alt="App Icon" className="w-10 h-10 rounded-xl object-cover ring-1 ring-emerald-500/40" />
                <div>
                  <h3 className="text-base font-bold text-white">Install on iPhone / iPad</h3>
                  <p className="text-xs text-emerald-400">Add to Home Screen</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-300">
                1. Tap the <strong className="text-white">Share</strong> button at the bottom of Safari.<br />
                2. Scroll down and select <strong className="text-white">Add to Home Screen</strong>.<br />
                3. Tap <strong className="text-white">Add</strong> in the top-right corner.
              </p>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-slate-800 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
