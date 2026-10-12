import React from 'react';
import { WifiOff, AlertTriangle } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-50 flex items-center gap-3 rounded-xl bg-amber-950/90 border border-amber-500/50 px-4 py-3 text-xs font-medium text-amber-200 shadow-2xl backdrop-blur-md animate-bounce">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
        <WifiOff className="w-4 h-4" />
      </div>
      <div>
        <div className="font-bold text-white flex items-center gap-1.5">
          <span>Offline Mode</span>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
        </div>
        <p className="text-[11px] text-amber-300/80">
          Viewing cached application data. Will auto-sync when connection is restored.
        </p>
      </div>
    </div>
  );
};
