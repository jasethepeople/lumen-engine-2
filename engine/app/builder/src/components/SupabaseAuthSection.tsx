import { useState, useEffect } from 'react';
import { backend } from '../platform/backend';

export function SupabaseAuthSection() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend.auth.getUser().then((u: any) => {
    if (u) {
      setUser(u);
    }
  }).catch(() => {});
  }, []);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = (backend.auth as any);
      if (typeof auth.signIn === 'function') {
        await auth.signIn({ email, password });
      } else if (typeof auth.login === 'function') {
        await auth.login(email, password);
      } else {
        throw new Error('Sign in method not available on backend auth');
      }
      const u = await backend.auth.getUser();
      setUser(u);
    } catch (err: any) {
      setError(err?.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = (backend.auth as any);
      if (typeof auth.signUp === 'function') {
        await auth.signUp({ email, password });
      } else if (typeof auth.register === 'function') {
        await auth.register(email, password);
      } else {
        throw new Error('Sign up method not available on backend auth');
      }
      const u = await backend.auth.getUser();
      setUser(u);
    } catch (err: any) {
      setError(err?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    try {
      const auth = (backend.auth as any);
      if (typeof auth.signOut === 'function') {
        await auth.signOut();
      } else if (typeof auth.logout === 'function') {
        await auth.logout();
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 bg-black/30 border border-white/10 rounded-lg space-y-3">
      <h3 className="text-sm font-medium text-white">SUPABASE AUTH & SAAS PAYWALL</h3>
      {user ? (
        <div className="space-y-2">
          <p className="text-xs text-emerald-400">Authenticated: {user.email || user.id}</p>
          <button onClick={handleSignOut} disabled={loading} className="btn btn-secondary text-xs w-full">
            Sign Out
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-zinc-400">Sign in or register to unlock Pro SaaS tiers and cloud syncing.</p>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input text-xs w-full px-2 py-1 bg-black/40 border border-white/10 rounded text-white"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input text-xs w-full px-2 py-1 bg-black/40 border border-white/10 rounded text-white"
          />
          <div className="flex gap-2 pt-1">
            <button onClick={handleSignIn} disabled={loading || !email || !password} className="btn btn-primary text-xs flex-1">
              Sign In
            </button>
            <button onClick={handleSignUp} disabled={loading || !email || !password} className="btn btn-secondary text-xs flex-1">
              Register
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
