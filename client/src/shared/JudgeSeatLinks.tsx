import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useJudgeAccess } from './useJudgeAccess';

const seats = [1, 2, 3] as const;

const seatButton =
  'w-full py-8 bg-zinc-800 active:bg-zinc-700 hover:bg-zinc-700 rounded-2xl text-white text-3xl font-black flex items-center justify-center gap-3 touch-manipulation';

/** One button per judge seat; a lock marks a seat that asks for its password next. */
export default function JudgeSeatLinks() {
  const access = useJudgeAccess();
  return (
    <>
      {seats.map(seat => (
        <Link key={seat} to={`/judge/${seat}`} className={seatButton}>
          Судья {seat}
          {access.protected[seat - 1] && <Lock size={22} className="text-zinc-400" aria-label="нужен пароль" />}
        </Link>
      ))}
    </>
  );
}
