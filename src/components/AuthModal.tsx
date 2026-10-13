import React, { useState } from 'react';
import { signInWithGoogle, signInWithEmail, signUpWithEmail } from '../services/firebase';
import { firebaseConfig } from '../services/firebase-config';
import { Shield, Copy, Check, AlertCircle, ExternalLink, Mail, Lock, User as UserIcon, ArrowRight } from 'lucide-react';
import { User } from 'firebase/auth';

interface AuthModalProps {
  isOpen: boolean;
  onSuccess: (user: User) => void;
  onClose?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onSuccess, onClose }) => {
  const [mode, setMode] = useState<'google' | 'email_login' | 'email_signup'>('google');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domainError, setDomainError] = useState<boolean>(false);
  const [copiedDomain, setCopiedDomain] = useState(false);

  // Email form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  if (!isOpen) return null;

  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    setDomainError(false);

    try {
      const user = await signInWithGoogle();
      onSuccess(user);
    } catch (err: any) {
      const isDomainIssue =
        err.code === 'auth/unauthorized-domain' ||
        err.message?.includes('unauthorized-domain') ||
        err.code === 'auth/invalid-continue-uri' ||
        err.message?.includes('invalid-continue-uri') ||
        err.code === 'auth/unauthorized-continue-uri' ||
        err.message?.includes('unauthorized-continue-uri');

      if (isDomainIssue) {
        setDomainError(true);
        setError(`This domain (${currentHost}) is awaiting Firebase Authorized Domains whitelist. You can use Email/Password sign-up below to create a direct Firebase account.`);
      } else if (err.code === 'auth/popup-blocked') {
        setError('Google login popup was blocked by your browser. Please allow popups.');
      } else {
        setError(err.message || 'Google sign-in encountered an issue.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    setError(null);

    try {
      let user: User;
      if (mode === 'email_signup') {
        user = await signUpWithEmail(email, password, name);
      } else {
        user = await signInWithEmail(email, password);
      }
      onSuccess(user);
    } catch (err: any) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        setError('Invalid credentials. If you are new, choose "Create New Account" below.');
      } else {
        setError(err.message || 'Authentication error.');
      }
    } finally {
      setLoading(false);
    }
  };

  const copyDomain = () => {
    navigator.clipboard.writeText(currentHost);
    setCopiedDomain(true);
    setTimeout(() => setCopiedDomain(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-6 text-center border-b border-slate-800 bg-gradient-to-b from-slate-800/40 to-slate-900">
          <div className="relative inline-block mb-3">
            <img
              src="/solva.webp"
              alt="SOLVATECH"
              className="w-14 h-14 rounded-2xl object-cover ring-2 ring-emerald-500/50 shadow-lg shadow-emerald-950/50 mx-auto"
            />
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">Sign in to SOLVATECH</h2>
          <p className="text-xs text-slate-400 mt-1">
            Personal Firebase Account Sync • WhatsApp Bot & License Protection
          </p>
        </div>

        <div className="p-6 space-y-4">
          {/* Domain Notice (Shown only if Firebase OAuth popup encounters unauthorized domain) */}
          {domainError && (
            <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/40 space-y-3 animate-in fade-in duration-150">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-200 space-y-1">
                  <p className="font-bold text-amber-300">Firebase Authorized Domain Notice</p>
                  <p className="text-[11px] text-amber-300/80 leading-relaxed">
                    Google OAuth popup requires this domain to be whitelisted in Firebase Console. You can also sign up with Email & Password below!
                  </p>
                </div>
              </div>

              {/* Whitelist Domain helper */}
              <div className="pt-1 border-t border-amber-500/20 text-[11px] text-amber-300/80 flex items-center justify-between">
                <span className="font-mono truncate max-w-[200px]">{currentHost}</span>
                <button
                  type="button"
                  onClick={copyDomain}
                  className="inline-flex items-center gap-1 text-emerald-400 hover:underline font-semibold"
                >
                  {copiedDomain ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedDomain ? 'Copied' : 'Copy Domain'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Mode 1: Google Sign-In (Primary First Action) */}
          {mode === 'google' && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm shadow-lg transition-all active:scale-[0.98] disabled:opacity-50"
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
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
                <span>{loading ? 'Connecting with Google...' : 'Continue with Google'}</span>
              </button>

              <div className="relative flex items-center justify-center py-2">
                <div className="border-t border-slate-800 w-full"></div>
                <span className="bg-slate-900 px-3 text-[11px] text-slate-500 uppercase tracking-wider absolute">
                  or continue with email
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('email_signup')}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold transition-all"
                >
                  <UserIcon className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Create Account</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('email_login')}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold transition-all"
                >
                  <Mail className="w-3.5 h-3.5 text-teal-400" />
                  <span>Sign In</span>
                </button>
              </div>
            </div>
          )}

          {/* Mode 2 & 3: Email / Password Auth */}
          {(mode === 'email_login' || mode === 'email_signup') && (
            <form onSubmit={handleEmailAuth} className="space-y-3 text-xs">
              {mode === 'email_signup' && (
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Full Name</label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Solomon Awoyinfa"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                      required
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-bold text-xs shadow-md transition-all disabled:opacity-50 mt-1"
              >
                {loading
                  ? 'Processing...'
                  : mode === 'email_signup'
                  ? 'Create SOLVATECH Account'
                  : 'Sign In to Account'}
              </button>

              <div className="flex items-center justify-between pt-2 text-[11px] text-slate-400">
                <button
                  type="button"
                  onClick={() => setMode(mode === 'email_login' ? 'email_signup' : 'email_login')}
                  className="text-emerald-400 hover:underline"
                >
                  {mode === 'email_login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('google')}
                  className="text-slate-400 hover:text-white"
                >
                  Back to Google
                </button>
              </div>
            </form>
          )}

          {error && !domainError && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <div className="pt-2 text-center text-[10px] text-slate-500">
            Firebase Project: <code className="text-slate-400">{firebaseConfig.authDomain}</code>
          </div>
        </div>
      </div>
    </div>
  );
};
