import { useEffect, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, Smartphone } from 'lucide-react';
import { fetchJudgeSeats, type JudgeSeats } from '../api/socket';
import ConfirmDialog from './ConfirmDialog';

const seats = [1, 2, 3] as const;
const REFRESH_MS = 3_000;

const seatButton =
  'w-full py-8 bg-zinc-800 active:bg-zinc-700 hover:bg-zinc-700 rounded-2xl text-white text-3xl font-black flex items-center justify-center gap-3 touch-manipulation';

/** Which seats are locked and taken, asked again every few seconds while shown. */
function useJudgeSeats(): JudgeSeats | null {
  const [state, setState] = useState<JudgeSeats | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetchJudgeSeats().then(s => { if (live && s) setState(s); });
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => { live = false; clearInterval(timer); };
  }, []);
  return state;
}

/**
 * One button per judge seat; a lock marks a seat that asks for its password
 * next, a phone one that already has a judge on it. Taking a seat disconnects
 * the phone on it, so that asks first: the start screen is open on every
 * device, and one stray tap must not stop a judge scoring.
 */
export default function JudgeSeatLinks() {
  const known = useJudgeSeats();
  const navigate = useNavigate();
  const [confirmSeat, setConfirmSeat] = useState(0);

  const pick = async (e: MouseEvent, seat: number) => {
    e.preventDefault();
    const fresh = await fetchJudgeSeats(); // the shown state may be 3 s old
    if (fresh?.occupied[seat - 1]) setConfirmSeat(seat);
    else navigate(`/judge/${seat}`);
  };

  return (
    <>
      {seats.map(seat => (
        <Link key={seat} to={`/judge/${seat}`} onClick={e => pick(e, seat)} className={seatButton}>
          Судья {seat}
          {known?.protected[seat - 1] && <Lock size={22} className="text-zinc-400" aria-label="нужен пароль" />}
          {known?.occupied[seat - 1] && <Smartphone size={22} className="text-emerald-400" aria-label="уже подключён" />}
        </Link>
      ))}
      {confirmSeat > 0 && (
        <ConfirmDialog
          title={`Судья ${confirmSeat} уже подключён`}
          confirmLabel="Занять место"
          danger
          onConfirm={() => navigate(`/judge/${confirmSeat}`)}
          onCancel={() => setConfirmSeat(0)}
        >
          На этом месте уже работает другой телефон. Если занять место здесь, тот телефон отключится и перестанет судить.
        </ConfirmDialog>
      )}
    </>
  );
}
