import React, { useState, useRef, useEffect } from 'react';
import { User } from 'firebase/auth';
import { signOutUser } from '../services/firebase';
import { isOwnerEmail } from '../services/admin-config';
import { LogOut, Shield, Key, ChevronDown, User as UserIcon } from 'lucide-react';

interface UserAccountNavProps {
  user: User | null;
  onOpenAuthModal: () => void;
}

export const UserAccountNav: React.FC<UserAccountNavProps> = ({ user, onOpenAuthModal }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) {
    return (
      <button
        onClick={onOpenAuthModal}
        className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs shadow-md transition-all active:scale-95"
      >
        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
          />
        </svg>
        <span>Sign in with Google</span>
      </button>
    );
  }

  const isOwner = Boolean(user.email && isOwnerEmail(user.email));
  const licenseKey = isOwner ? 'SOLVA-OWNER-UNLIMITED-MASTER' : `SOLVA-${user.uid.slice(0, 6).toUpperCase()}-2026`;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 p-1 pl-2 sm:pl-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 transition-all text-xs shrink-0 cursor-pointer"
      >
        <div className="text-left hidden md:block">
          <p className="font-bold text-white text-[11px] leading-tight truncate max-w-[100px]">
            {user.displayName || 'User'}
          </p>
          <p className="text-[9px] text-emerald-400 font-mono leading-tight">
            Personal
          </p>
        </div>

        <img
          src={user.photoURL || '/solva.webp'}
          alt="User avatar"
          className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg object-cover ring-1 ring-emerald-500/50"
        />
        <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-60 sm:w-64 max-w-[calc(100vw-2rem)] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95 duration-100 space-y-3">
          <div className="pb-2.5 border-b border-slate-800 flex items-center gap-2.5 min-w-0">
            <img
              src={user.photoURL || '/solva.webp'}
              alt="User avatar"
              className="w-8 h-8 rounded-xl object-cover ring-1 ring-emerald-500/50 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-white text-xs truncate">{user.displayName || 'Personal Account'}</p>
              <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
            </div>
          </div>

          {/* License Details */}
          <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1">
            <div className="flex items-center justify-between text-[11px] gap-2">
              <span className="text-slate-400 flex items-center gap-1 shrink-0">
                <Key className="w-3 h-3 text-amber-400" /> License:
              </span>
              <span className="font-mono text-emerald-400 font-bold truncate text-[10px]">{licenseKey}</span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>Firebase Cloud:</span>
              <span className="text-slate-300">Active 🟢</span>
            </div>
          </div>

          <button
            onClick={async () => {
              setIsOpen(false);
              await signOutUser();
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-950/60 border border-rose-500/30 text-rose-300 text-xs font-bold transition-colors cursor-pointer active:scale-98"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out of Dashboard</span>
          </button>
          <p className="text-[10px] text-slate-400 text-center mt-1.5 leading-tight">
            🛡️ Your WhatsApp bot stays active and connected 24/7 on the server after sign out.
          </p>
        </div>
      )}
    </div>
  );
};
