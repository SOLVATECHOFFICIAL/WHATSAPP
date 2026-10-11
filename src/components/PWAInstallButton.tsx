import React, { useState } from 'react';
import { Download, Smartphone, X, CheckCircle2, Sparkles, Share, MoreVertical, ExternalLink } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{
  variant?: 'button' | 'banner';
}> = ({ variant = 'button' }) => {
  const { hasPrompt, isInstalled, isIOS, isAndroid, isInAppBrowser, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isPrompting, setIsPrompting] = useState(false);

  // If already installed in standalone mode, hide
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (hasPrompt) {
      setIsPrompting(true);
      try {
        const accepted = await install();
        if (!accepted) {
          // If dismissed or failed, show guide modal as fallback
          setShowGuideModal(true);
        }
      } catch {
        setShowGuideModal(true);
      } finally {
        setIsPrompting(false);
      }
    } else {
      // Chrome hasn't fired prompt yet, or iOS Safari, or in-app browser
      setShowGuideModal(true);
    }
  };

  const renderGuideModal = () => {
    if (!showGuideModal) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-200">
        <div className="w-full max-w-md rounded-2xl border border-emerald-500/40 bg-gradient-to-b from-slate-900 to-slate-950 p-6 shadow-2xl relative">
          <button
            onClick={() => setShowGuideModal(false)}
            className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 mb-4">
            <div className="relative w-12 h-12 rounded-xl overflow-hidden ring-2 ring-emerald-500/50 shadow-md">
              <img src="/solva.webp" alt="SOLVATECH" className="w-full h-full object-cover" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                Install SOLVATECH App
              </h3>
              <p className="text-xs text-emerald-400 font-medium">Standalone Native PWA • Offline Ready</p>
            </div>
          </div>

          {isInAppBrowser && (
            <div className="mb-4 p-3 rounded-xl bg-amber-950/60 border border-amber-500/40 text-amber-200 text-xs space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                ⚠️ In-App Browser Detected (WhatsApp / Social Media)
              </p>
              <p className="text-amber-300/90 text-[11px] leading-relaxed">
                To install this app on your phone, open this page in Chrome or Safari:
                <br />
                Tap <strong className="text-white">⋮ (3 dots)</strong> in the top corner and tap <strong className="text-white">"Open in Chrome"</strong> or <strong className="text-white">"Open in browser"</strong>.
              </p>
            </div>
          )}

          {isIOS ? (
            <div className="space-y-3 text-xs text-slate-200">
              <p className="text-slate-300">
                Install directly on your iPhone / iPad via Safari:
              </p>
              <div className="p-3.5 rounded-xl bg-slate-800/80 border border-slate-700/80 space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                    1
                  </div>
                  <div>
                    Tap the <strong className="text-white flex-inline items-center gap-1">Share <Share className="w-3.5 h-3.5 inline text-emerald-400" /></strong> button at the bottom of Safari.
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                    2
                  </div>
                  <div>
                    Scroll down and select <strong className="text-white">"Add to Home Screen"</strong>.
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                    3
                  </div>
                  <div>
                    Tap <strong className="text-white">"Add"</strong> in the top-right corner. The SOLVATECH app icon will appear on your screen!
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-xs text-slate-200">
              <p className="text-slate-300">
                Install on Android Phone, Chrome or Desktop:
              </p>
              <div className="p-3.5 rounded-xl bg-slate-800/80 border border-slate-700/80 space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                    1
                  </div>
                  <div>
                    Tap Chrome's menu icon <strong className="text-white inline-flex items-center gap-0.5"><MoreVertical className="w-3.5 h-3.5 inline text-emerald-400" /> (3 dots)</strong> at the top right of your browser.
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                    2
                  </div>
                  <div>
                    Tap <strong className="text-white">"Install app"</strong> or <strong className="text-white">"Add to Home screen"</strong>.
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                    3
                  </div>
                  <div>
                    Tap <strong className="text-white">"Install"</strong> to confirm. The app will launch with full offline support and instant 1-tap access!
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button
              onClick={() => setShowGuideModal(false)}
              className="flex-1 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-400 transition"
            >
              Got It, I'll Install Now
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Banner mode: Prompts user when browsing on Chrome / mobile to install if they don't have it
  if (variant === 'banner') {
    if (dismissed) return null;

    return (
      <>
        <div className="relative mb-4 overflow-hidden rounded-2xl border border-emerald-500/40 bg-gradient-to-r from-emerald-950/90 via-slate-900/95 to-cyan-950/90 p-3.5 shadow-xl backdrop-blur-md">
          <button
            onClick={() => setDismissed(true)}
            className="absolute top-2.5 right-2.5 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative w-12 h-12 shrink-0 rounded-2xl overflow-hidden ring-2 ring-emerald-500/50 shadow-md bg-slate-900">
              <img src="/solva.webp" alt="SOLVATECH App" className="w-full h-full object-cover" />
              <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-slate-900"></span>
              </span>
            </div>
            <div className="flex-1 text-center sm:text-left min-w-0">
              <div className="flex items-center justify-center sm:justify-start gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 ring-1 ring-emerald-500/30">
                  <Smartphone className="w-3 h-3" /> Official Web App
                </span>
                <span className="text-[10px] text-cyan-300 font-semibold bg-cyan-950/80 px-2 py-0.5 rounded-full border border-cyan-500/30">
                  Offline Ready • 24/7 Fast
                </span>
              </div>
              <h4 className="mt-1 font-bold text-white text-sm truncate">Install SOLVATECH on your Phone</h4>
              <p className="text-xs text-slate-300 mt-0.5 line-clamp-1">
                Install as a standalone app on your home screen for instant access and 24/7 background control!
              </p>
            </div>
            <div className="shrink-0 w-full sm:w-auto">
              <button
                onClick={handleInstallClick}
                disabled={isPrompting}
                className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-400 active:scale-95 transition cursor-pointer"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>{isPrompting ? 'Opening...' : 'Install App'}</span>
              </button>
            </div>
          </div>
        </div>

        {renderGuideModal()}
      </>
    );
  }

  // Header button mode: ALWAYS visible for anyone who doesn't have the app installed!
  return (
    <>
      <button
        onClick={handleInstallClick}
        disabled={isPrompting}
        className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-500/50 px-2.5 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 active:scale-95 transition shadow-sm shadow-emerald-500/10 cursor-pointer"
        title="Install SOLVATECH App on Phone / Desktop"
      >
        <Download className="w-3.5 h-3.5 text-emerald-400 animate-bounce" />
        <span className="inline font-bold">Install App</span>
      </button>

      {renderGuideModal()}
    </>
  );
};
