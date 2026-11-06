import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { loginAdmin } from '../api/socket';

const errors: Record<string, string> = {
  wrong_login: 'Wrong login or password',
  no_connection: 'No connection to the server',
  server_error: 'Server error, try again',
};

/** Shown instead of the operator's pages until the admin logs in. */
export default function AdminLogin({ expired }: { expired: boolean }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(expired ? 'Logged out: the admin password was changed' : '');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await loginAdmin(login, password);
    setBusy(false);
    if (r.reason === 'too_many_attempts') {
      setError(`Too many failed logins. Try again in ${r.retryAfterS ?? 30} s`);
    } else if (!r.ok) {
      setError(errors[r.reason ?? ''] ?? `Login failed: ${r.reason}`);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-3">
        <div className="flex items-center justify-center gap-2 text-white text-2xl font-black mb-2">
          <Lock size={22} /> Admin
        </div>
        <input value={login} onChange={e => setLogin(e.target.value)} placeholder="Login" autoFocus autoComplete="username"
          className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500" />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password"
          className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500" />
        {error && <div className="text-red-400 text-center text-sm font-bold">{error}</div>}
        <button type="submit" disabled={busy || !login || !password}
          className="py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-black rounded-xl cursor-pointer">
          Log in
        </button>
      </form>
    </div>
  );
}
