import { useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const STORAGE_KEY_INSTALLED = 'solvatech_pwa_installed';
const STORAGE_KEY_DISMISSED = 'solvatech_pwa_banner_hidden';

function checkAlreadyInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      document.referrer.includes('android-app://');
    const storedInstalled =
      localStorage.getItem(STORAGE_KEY_INSTALLED) === 'true' ||
      localStorage.getItem('pwa_installed') === 'true' ||
      sessionStorage.getItem(STORAGE_KEY_INSTALLED) === 'true';
    return isStandalone || storedInstalled;
  } catch {
    return false;
  }
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => checkAlreadyInstalled());

  const [isBannerHidden, setIsBannerHidden] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return (
        checkAlreadyInstalled() ||
        localStorage.getItem(STORAGE_KEY_DISMISSED) === 'true'
      );
    } catch {
      return false;
    }
  });

  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);

  useEffect(() => {
    if (checkAlreadyInstalled()) {
      setIsInstalled(true);
      setIsBannerHidden(true);
      return;
    }

    // Detect platform
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    const isAndroidDevice = /android/.test(userAgent);
    const inApp = /wv|whatsapp|fbav|instagram|messenger|line|micromessenger/.test(userAgent);

    setIsIOS(isIOSDevice);
    setIsAndroid(isAndroidDevice);
    setIsInAppBrowser(inApp);

    // If browser supports getInstalledRelatedApps, query if app is already installed on device
    if ('getInstalledRelatedApps' in window.navigator) {
      (window.navigator as any).getInstalledRelatedApps().then((relatedApps: any[]) => {
        if (Array.isArray(relatedApps) && relatedApps.length > 0) {
          setIsInstalled(true);
          setIsBannerHidden(true);
          try {
            localStorage.setItem(STORAGE_KEY_INSTALLED, 'true');
            localStorage.setItem(STORAGE_KEY_DISMISSED, 'true');
          } catch {}
        }
      }).catch(() => {});
    }

    if ((window as any).__pwaPrompt) {
      setDeferredPrompt((window as any).__pwaPrompt as BeforeInstallPromptEvent);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent default mini-infobar and capture event
      e.preventDefault();
      (window as any).__pwaPrompt = e;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsBannerHidden(true);
      setDeferredPrompt(null);
      (window as any).__pwaPrompt = null;
      try {
        localStorage.setItem(STORAGE_KEY_INSTALLED, 'true');
        localStorage.setItem(STORAGE_KEY_DISMISSED, 'true');
      } catch {}
    };

    const handleGlobalPwaInstalled = () => {
      setIsInstalled(true);
      setIsBannerHidden(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('solvatech:pwa-installed', handleGlobalPwaInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('solvatech:pwa-installed', handleGlobalPwaInstalled);
    };
  }, []);

  const markAsInstalledOnPhone = useCallback(() => {
    setIsInstalled(true);
    setIsBannerHidden(true);
    try {
      localStorage.setItem(STORAGE_KEY_INSTALLED, 'true');
      localStorage.setItem('pwa_installed', 'true');
      localStorage.setItem(STORAGE_KEY_DISMISSED, 'true');
      sessionStorage.setItem(STORAGE_KEY_INSTALLED, 'true');
      window.dispatchEvent(new Event('solvatech:pwa-installed'));
    } catch {}
  }, []);

  const dismissBannerPermanently = useCallback(() => {
    setIsBannerHidden(true);
    try {
      localStorage.setItem(STORAGE_KEY_DISMISSED, 'true');
    } catch {}
  }, []);

  const install = async () => {
    if (!deferredPrompt) {
      markAsInstalledOnPhone();
      return true;
    }
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => null);
      markAsInstalledOnPhone();
      setDeferredPrompt(null);
      (window as any).__pwaPrompt = null;
      return choice ? choice.outcome === 'accepted' : true;
    } catch (err) {
      console.warn('PWA install prompt error (app may already be installed):', err);
      markAsInstalledOnPhone();
      setDeferredPrompt(null);
      (window as any).__pwaPrompt = null;
      return true;
    }
  };

  return {
    isInstallable: !!deferredPrompt,
    hasPrompt: !!deferredPrompt,
    isInstalled,
    isBannerHidden,
    isIOS,
    isAndroid,
    isInAppBrowser,
    install,
    markAsInstalledOnPhone,
    dismissBannerPermanently,
  };
}
