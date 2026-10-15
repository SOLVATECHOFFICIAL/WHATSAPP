import React, { useState, useEffect } from 'react';
import { Bell, ShieldAlert, CheckCircle, ArrowRight } from 'lucide-react';
import {
  getNotificationPermission,
  requestNotificationPermission,
  isNotificationSupported,
  type NotificationPermissionStatus,
} from '../services/notification-service';

interface NotificationBannerProps {
  onPermissionGranted?: () => void;
}

export const NotificationBanner: React.FC<NotificationBannerProps> = ({ onPermissionGranted }) => {
  const [permission, setPermission] = useState<NotificationPermissionStatus>('granted');
  const [requesting, setRequesting] = useState(false);
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    if (!isNotificationSupported()) {
      setIsSupported(false);
      return;
    }
    const currentPerm = getNotificationPermission();
    setPermission(currentPerm);

    // Periodically re-check permission if user changed it in browser settings
    const interval = setInterval(() => {
      const p = getNotificationPermission();
      setPermission(p);
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  const handleAllowNotification = async () => {
    setRequesting(true);
    try {
      const nextPerm = await requestNotificationPermission();
      setPermission(nextPerm);
      if (nextPerm === 'granted') {
        onPermissionGranted?.();
      }
    } finally {
      setRequesting(false);
    }
  };

  // If notifications are unsupported or already granted, do not render banner
  if (!isSupported || permission === 'granted') {
    return null;
  }

  const isDenied = permission === 'denied';

  return (
    <div className="w-full bg-gradient-to-r from-amber-950 via-slate-900 to-emerald-950 border-b border-amber-500/40 px-3.5 py-2.5 shadow-lg relative z-40 animate-in fade-in slide-in-from-top duration-300">
      <div className="max-w-lg mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0 animate-pulse">
            <Bell className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-black text-white tracking-tight">Allow Notification</span>
              <span className="px-1.5 py-0.2 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/30">
                Action Required
              </span>
            </div>
            <p className="text-[11px] text-slate-300 leading-tight mt-0.5">
              {isDenied
                ? 'Notifications are blocked in your browser settings. Tap the lock icon in your address bar to set Notifications to "Allow".'
                : 'Turn on notifications to get instant alerts when Admin adds time, grants VIP unlimited, and 30m/15m/5m expiry warnings.'}
            </p>
          </div>
        </div>

        <div className="w-full sm:w-auto shrink-0 flex items-center justify-end">
          {isDenied ? (
            <div className="px-3 py-1.5 rounded-xl bg-slate-800 border border-amber-500/40 text-amber-300 text-[11px] font-bold flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              <span>Allow in browser settings</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleAllowNotification}
              disabled={requesting}
              className="w-full sm:w-auto px-4 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs shadow-md transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer disabled:opacity-50"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>{requesting ? 'Enabling...' : 'Allow Notification'}</span>
              <ArrowRight className="w-3 h-3 ml-0.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
