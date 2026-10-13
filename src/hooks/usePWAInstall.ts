import { useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const STORAGE_KEY_INSTALLED = 'solvatech_pwa_installed';
const STORAGE_KEY_DISMISSED = 'solvatech_pwa_banner_hidden';

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      document.referrer.includes('android-app://');
    const storedInstalled = localStorage.getItem(STORAGE_KEY_INSTALLED) === 'true';
    return isStandalone || storedInstalled;
  });

  const [isBannerHidden, setIsBannerHidden] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      localStorage.getItem(STORAGE_KEY_INSTALLED) === 'true' ||
      localStorage.getItem(STORAGE_KEY_DISMISSED) === 'true'
    );
  });

  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);

  useEffect(() => {
    // Detect standalone mode (already installed or running as standalone PWA)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      document.referrer.includes('android-app://');
    const storedInstalled = localStorage.getItem(STORAGE_KEY_INSTALLED) === 'true';
    const storedDismissed = localStorage.getItem(STORAGE_KEY_DISMISSED) === 'true';

    if (isStandalone || storedInstalled) {
      setIsInstalled(true);
      setIsBannerHidden(true);
    } else if (storedDismissed) {
      setIsBannerHidden(true);
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

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const markAsInstalledOnPhone = useCallback(() => {
    setIsInstalled(true);
    setIsBannerHidden(true);
    try {
      localStorage.setItem(STORAGE_KEY_INSTALLED, 'true');
      localStorage.setItem(STORAGE_KEY_DISMISSED, 'true');
    } catch {}
  }, []);

  const dismissBannerPermanently = useCallback(() => {
    setIsBannerHidden(true);
    try {
      localStorage.setItem(STORAGE_KEY_DISMISSED, 'true');
    } catch {}
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setIsBannerHidden(true);
        setDeferredPrompt(null);
        try {
          localStorage.setItem(STORAGE_KEY_INSTALLED, 'true');
          localStorage.setItem(STORAGE_KEY_DISMISSED, 'true');
        } catch {}
        return true;
      }
    } catch (err) {
      console.warn('PWA install prompt error:', err);
    }
    return false;
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
