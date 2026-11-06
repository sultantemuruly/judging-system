import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useJudgeAccess } from '../../shared/useJudgeAccess';

const seats = [1, 2, 3] as const;

/** /judge: where a judge picks their seat. A seat with a lock asks for its password next. */
export default function JudgePicker() {
  const access = useJudgeAccess();
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-zinc-400 text-sm font-black uppercase tracking-widest mb-2">Выберите место судьи</h1>
      {seats.map(seat => (
        <Link
          key={seat}
          to={`/judge/${seat}`}
          className="w-full max-w-sm py-8 bg-zinc-800 active:bg-zinc-700 hover:bg-zinc-700 rounded-2xl text-white text-3xl font-black flex items-center justify-center gap-3 touch-manipulation"
        >
          Судья {seat}
          {access.protected[seat - 1] && <Lock size={22} className="text-zinc-400" aria-label="нужен пароль" />}
        </Link>
      ))}
    </div>
  );
}
