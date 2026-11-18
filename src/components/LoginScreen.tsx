import React, {useState} from 'react';
import {AlertTriangle, Lock, ShieldCheck} from 'lucide-react';
import {PWAInstallButton} from './PWAInstallButton';

interface LoginScreenProps {
  onLogin: (
    username: string,
    password: string,
  ) => Promise<{ok: boolean; error?: string}> | {ok: boolean; error?: string};
  sessionRevokedMessage?: string | null;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLogin,
  sessionRevokedMessage,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter both your assigned username and password.');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await onLogin(username, password);
      if (!result.ok) {
        setError(result.error || 'Authentication failed.');
      } else {
        setError(null);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeError = error || sessionRevokedMessage;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#06090e] px-4 py-8">
      <div className="cyber-card w-full max-w-md rounded-2xl p-6 sm:p-8 shadow-[0_0_45px_rgba(0,240,255,0.16)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="neon-badge-cyan inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-mono font-bold uppercase">
              <span>Pure MSNR + Order Flow</span>
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight glow-cyan">
              Makka Footprint Bot
            </h1>
            <p className="mt-1 text-xs text-slate-400 font-mono">
              Institutional MSNR &amp; Order-Flow Terminal
            </p>
          </div>
          <PWAInstallButton compact />
        </div>

        {activeError && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-500/45 bg-rose-950/35 p-3.5 text-xs text-rose-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
            <span className="leading-relaxed font-medium">{activeError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
          <div>
            <label
              htmlFor="makka-login-username"
              className="block text-xs font-mono font-bold text-slate-300"
            >
              Assigned Username
            </label>
            <input
              id="makka-login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter admin-created username"
              className="mt-1.5 w-full rounded-xl border border-slate-700/80 bg-[#06090e] px-3.5 py-2.5 text-sm font-mono text-slate-100 placeholder-slate-500 transition-colors focus:border-cyan-400 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="makka-login-password"
              className="block text-xs font-mono font-bold text-slate-300"
            >
              Access Password
            </label>
            <input
              id="makka-login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter assigned password"
              className="mt-1.5 w-full rounded-xl border border-slate-700/80 bg-[#06090e] px-3.5 py-2.5 text-sm font-mono text-slate-100 placeholder-slate-500 transition-colors focus:border-cyan-400 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 flex w-full min-h-[46px] items-center justify-center gap-2 rounded-xl border border-cyan-400/60 bg-cyan-500/20 px-4 py-2.5 text-sm font-black font-mono glow-cyan transition-all hover:bg-cyan-500/30 disabled:opacity-60 cursor-pointer shadow-[0_0_20px_rgba(0,240,255,0.2)]"
          >
            <Lock className="h-4 w-4" aria-hidden="true" />
            <span>{isSubmitting ? 'AUTHENTICATING...' : 'LOGIN TO TERMINAL'}</span>
          </button>
        </form>

        <div className="mt-5 border-t border-slate-800/80 pt-4 text-[11px] font-mono text-slate-400 flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
          <span>Authorized operator access only. Single-device license lock enforced.</span>
        </div>
      </div>
    </main>
  );
};
