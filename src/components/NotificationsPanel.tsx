import React, { useState } from 'react';
import { Bell, MessageSquare, Link2, AlertCircle, Info, Trash2, CheckCircle2, Send, Terminal, RefreshCw } from 'lucide-react';

export interface WhatsAppNotification {
  id: string;
  type: 'pairing' | 'connection' | 'message_received' | 'message_sent' | 'system' | 'error' | 'command' | 'warning';
  title: string;
  body: string;
  timestamp: string;
  sender?: string;
  data?: any;
}

interface NotificationsPanelProps {
  notifications: WhatsAppNotification[];
  onClear: () => void;
  isOpen: boolean;
  onClose: () => void;
  isConnected?: boolean;
  userId?: string;
}

export const NotificationsPanel: React.FC<NotificationsPanelProps> = ({
  notifications,
  onClear,
  isOpen,
  onClose,
  isConnected = false,
  userId = '',
}) => {
  const [filter, setFilter] = useState<'all' | 'messages' | 'pairing'>('all');
  const [sendingTest, setSendingTest] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<NotificationPermission>(() => {
    return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default';
  });

  if (!isOpen) return null;

  const handleRequestPushPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const perm = await Notification.requestPermission();
        setPermissionState(perm);
        if (perm === 'granted') {
          setTestStatus('Real device notifications enabled!');
          try {
            new Notification('SOLVATECH Notifications Enabled', {
              body: 'You will now receive real-time WhatsApp pairing and bot alerts on this device.',
              icon: '/solva.webp',
            });
          } catch {}
        }
      } catch (err) {
        console.warn('Permission request error:', err);
      }
    }
  };

  const handleSendTestDM = async () => {
    setSendingTest(true);
    setTestStatus(null);
    try {
      const res = await fetch('/api/whatsapp/test-dm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (data.success) {
        setTestStatus('Notification sent to your WhatsApp DM!');
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification('WhatsApp Test Dispatched 🔔', {
              body: 'Test notification was dispatched directly to your personal WhatsApp chat.',
              icon: '/solva.webp',
            });
          } catch {}
        }
      } else {
        setTestStatus(data.error || 'Failed to send');
      }
    } catch {
      setTestStatus('Network error sending test DM');
    } finally {
      setSendingTest(false);
      setTimeout(() => setTestStatus(null), 4000);
    }
  };

  const filteredNotifications = notifications.filter((n) => {
    if (filter === 'messages') return n.type === 'message_received' || n.type === 'message_sent';
    if (filter === 'pairing') return n.type === 'pairing' || n.type === 'connection';
    return true;
  });

  const getIcon = (type: WhatsAppNotification['type']) => {
    switch (type) {
      case 'pairing':
        return <Link2 className="w-4 h-4 text-emerald-500" />;
      case 'connection':
        return <CheckCircle2 className="w-4 h-4 text-teal-500" />;
      case 'message_received':
        return <MessageSquare className="w-4 h-4 text-emerald-600" />;
      case 'message_sent':
        return <Send className="w-4 h-4 text-blue-500" />;
      case 'command':
        return <Terminal className="w-4 h-4 text-amber-500" />;
      case 'warning':
        return <AlertCircle className="w-4 h-4 text-amber-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-rose-500" />;
      default:
        return <Info className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-white dark:bg-slate-900 shadow-2xl z-50 border-l border-slate-200 dark:border-slate-800 flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/60">
        <div className="flex items-center gap-2.5">
          <img
            src="/solva.webp"
            alt="SOLVATECH"
            className="w-9 h-9 rounded-xl object-cover ring-1 ring-emerald-500/40 shadow-sm shrink-0"
          />
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white text-sm">WhatsApp Notifications</h3>
            <p className="text-xs text-slate-500">Live Baileys stream ({notifications.length} events)</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {notifications.length > 0 && (
            <button
              onClick={onClear}
              title="Clear all"
              className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="px-2.5 py-1 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 flex gap-1.5 bg-white dark:bg-slate-900">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
            filter === 'all'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
              : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          All ({notifications.length})
        </button>
        <button
          onClick={() => setFilter('messages')}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
            filter === 'messages'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
              : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          Messages
        </button>
        <button
          onClick={() => setFilter('pairing')}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
            filter === 'pairing'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
              : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          Pairing
        </button>
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredNotifications.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <Bell className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm font-medium">No notifications yet</p>
            <p className="text-xs text-slate-500 mt-1">
              Events such as pairing codes, socket link, and incoming messages will appear here live.
            </p>
          </div>
        ) : (
          filteredNotifications.map((notif) => (
            <div
              key={notif.id}
              className={`p-3 rounded-xl border text-left text-xs transition-all ${
                notif.type === 'message_received'
                  ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/50'
                  : notif.type === 'pairing'
                  ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/50'
                  : notif.type === 'error'
                  ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/50'
                  : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/60'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div className="p-1 rounded-md bg-white dark:bg-slate-800 shadow-2xs mt-0.5">
                  {getIcon(notif.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-slate-900 dark:text-white truncate">
                      {notif.title}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                      {notif.timestamp}
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 mt-1 break-words">
                    {notif.body}
                  </p>
                  {notif.sender && (
                    <span className="inline-block mt-2 px-2 py-0.5 bg-white dark:bg-slate-800 rounded font-mono text-[10px] text-emerald-600 dark:text-emerald-400 border border-slate-100 dark:border-slate-700">
                      From: {notif.sender}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer / Quick Actions */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 shrink-0 space-y-2">
        {permissionState !== 'granted' && (
          <button
            type="button"
            onClick={handleRequestPushPermission}
            className="w-full py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all shadow-xs active:scale-95 cursor-pointer"
          >
            <Bell className="w-3.5 h-3.5 text-amber-400" />
            <span>Enable Real Device Push Notifications</span>
          </button>
        )}
        <button
          onClick={handleSendTestDM}
          disabled={sendingTest || !isConnected}
          className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-sm active:scale-95 cursor-pointer disabled:cursor-not-allowed"
          title={isConnected ? 'Send a test notification to your personal WhatsApp DM' : 'Link WhatsApp first to test notifications'}
        >
          {sendingTest ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Sending Test to WhatsApp...</span>
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              <span>Send Test Notification to WhatsApp DM</span>
            </>
          )}
        </button>
        {testStatus && (
          <p className="text-[10px] text-center mt-1.5 font-medium text-emerald-600 dark:text-emerald-400 animate-in fade-in">
            {testStatus}
          </p>
        )}
      </div>
    </div>
  );
};
