import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { unlockSeat } from '../../api/socket';

/** Shown when the server refused this seat's password: ask for it and connect again. */
export default function PasswordGate({ seat, wrong }: { seat: number; wrong: boolean }) {
  const [password, setPassword] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) unlockSeat(password);
  };
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-4">
        <div className="flex items-center justify-center gap-2 text-white text-2xl font-black">
          <Lock size={22} /> Судья {seat}
        </div>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Пароль"
          className="w-full px-4 py-4 bg-zinc-800 border border-zinc-700 rounded-xl text-white text-xl text-center placeholder-zinc-500"
        />
        {wrong && <div className="text-red-400 text-center font-bold">Неверный пароль</div>}
        <button type="submit" disabled={!password}
          className="py-4 bg-emerald-600 disabled:opacity-40 text-white text-xl font-black rounded-xl cursor-pointer">
          Войти
        </button>
        <Link to="/judge" className="text-center text-zinc-500 text-sm">Другое место</Link>
      </form>
    </div>
  );
}
