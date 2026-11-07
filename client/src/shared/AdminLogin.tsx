import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Lock, Monitor } from 'lucide-react';
import { loginAdmin } from '../api/socket';
import JudgeSeatLinks from './JudgeSeatLinks';

const errors: Record<string, string> = {
  wrong_login: 'Wrong login or password',
  no_connection: 'No connection to the server',
  server_error: 'Server error, try again',
};

/**
 * Shown instead of the operator's pages until the admin logs in. It starts
 * with the four roles: the main judge logs in here, a side judge goes to
 * their seat; anyone can open the scoreboard (/board) without a login.
 */
export default function AdminLogin({ expired }: { expired: boolean }) {
  const [loggingIn, setLoggingIn] = useState(expired);
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm flex flex-col gap-4">
        {loggingIn
          ? <LoginForm expired={expired} onBack={() => setLoggingIn(false)} />
          : <>
              <h1 className="text-zinc-400 text-sm font-black uppercase tracking-widest text-center mb-2">Кто вы?</h1>
              <button type="button" onClick={() => setLoggingIn(true)} className="w-full py-8 bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-600 rounded-2xl text-white text-3xl font-black flex items-center justify-center gap-3 touch-manipulation cursor-pointer">
                Главный судья
                <Lock size={22} className="text-emerald-200" aria-label="нужен вход" />
              </button>
              <JudgeSeatLinks />
              <Link to="/board" className="w-full py-4 mt-2 border border-zinc-800 hover:bg-zinc-900 rounded-2xl text-zinc-300 text-xl font-black flex items-center justify-center gap-3 touch-manipulation">
                <Monitor size={20} /> Табло
              </Link>
            </>}
      </div>
    </div>
  );
}

function LoginForm({ expired, onBack }: { expired: boolean; onBack: () => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(expired ? 'Session ended, log in again' : '');
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
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="relative flex items-center justify-center gap-2 text-white text-2xl font-black mb-2">
        <button type="button" onClick={onBack} aria-label="Назад" className="absolute left-0 p-2 text-zinc-400 hover:text-white cursor-pointer">
          <ArrowLeft size={22} />
        </button>
        <Lock size={22} /> Главный судья
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
  );
}
