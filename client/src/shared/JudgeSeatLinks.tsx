import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, Smartphone } from 'lucide-react';
import { fetchJudgeSeats } from '../api/socket';
import ConfirmDialog from './ConfirmDialog';
import { seatChoice, type KnownSeats, type SeatChoice } from './seatChoice';

const seats = [1, 2, 3] as const;
const REFRESH_MS = 3_000;

const seatButton =
  'w-full py-8 bg-zinc-800 active:bg-zinc-700 hover:bg-zinc-700 rounded-2xl text-white text-3xl font-black flex items-center justify-center gap-3 touch-manipulation';

/** Which seats are locked and taken, asked again every few seconds while the page is visible. */
function useJudgeSeats(): KnownSeats | null {
  const [state, setState] = useState<KnownSeats | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.hidden) return;
      fetchJudgeSeats().then(s => { if (live && s) setState({ seats: s, at: Date.now() }); });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    document.addEventListener('visibilitychange', load);
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, []);
  return state;
}

const askText: Record<Exclude<SeatChoice, 'go'>, { title: (seat: number) => string; body: string }> = {
  occupied: {
    title: seat => `Судья ${seat} уже подключён`,
    body: 'На этом месте уже работает другой телефон. Если занять место здесь, тот телефон отключится и перестанет судить.',
  },
  unknown: {
    title: seat => `Не удалось проверить место судьи ${seat}`,
    body: 'Нет связи с сервером. Если на этом месте уже работает другой телефон, он отключится, как только связь вернётся.',
  },
};

/**
 * One button per judge seat; a lock marks a seat that asks for its password
 * next, a phone one that already has a judge on it. Taking a seat disconnects
 * the phone on it, so that asks first: the start screen is open on every
 * device, and one stray tap must not stop a judge scoring.
 */
export default function JudgeSeatLinks() {
  const known = useJudgeSeats();
  const navigate = useNavigate();
  const [ask, setAsk] = useState<{ seat: number; why: Exclude<SeatChoice, 'go'> } | null>(null);
  const checking = useRef(false);
  const mounted = useRef(true);
  const [busySeat, setBusySeat] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const pick = async (e: MouseEvent, seat: number) => {
    e.preventDefault();
    if (checking.current) return; // one check at a time; repeated taps are ignored
    checking.current = true;
    setBusySeat(seat);
    const fresh = await fetchJudgeSeats(); // the shown state may be 3 s old
    checking.current = false;
    // The page moved on meanwhile (e.g. «Главный судья», Back): don't pull it to the seat.
    if (!mounted.current) return;
    setBusySeat(0);
    const choice = seatChoice(fresh, known, seat);
    if (choice === 'go') navigate(`/judge/${seat}`);
    else setAsk({ seat, why: choice });
  };

  return (
    <>
      {seats.map(seat => (
        <Link key={seat} to={`/judge/${seat}`} onClick={e => pick(e, seat)} aria-busy={busySeat === seat}
          className={`${seatButton} ${busySeat === seat ? 'opacity-60' : ''}`}>
          Судья {seat}
          {known?.seats.protected[seat - 1] && <Lock size={22} className="text-zinc-400" aria-label="нужен пароль" />}
          {known?.seats.occupied[seat - 1] && <Smartphone size={22} className="text-emerald-400" aria-label="уже подключён" />}
        </Link>
      ))}
      {ask && (
        <ConfirmDialog
          title={askText[ask.why].title(ask.seat)}
          confirmLabel="Занять место"
          danger
          onConfirm={() => navigate(`/judge/${ask.seat}`)}
          onCancel={() => setAsk(null)}
        >
          {askText[ask.why].body}
        </ConfirmDialog>
      )}
    </>
  );
}
