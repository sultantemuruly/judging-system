import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { reclaimSeat, sameSession, sendAction, subscribeToResults } from '../../api/socket';
import type { Corner, FightView, Phase } from '../../api/protocol';
import { useConnection } from '../../shared/useConnection';
import { useWakeLock } from './useWakeLock';
// Undo2 is for the «Отменить» button, hidden for now (see below).
import { /* Undo2, */ WifiOff } from 'lucide-react';

interface Props {
  view: FightView;
}

/** Why the server refused a judge's action, in words a judge understands. */
const refusals: Record<string, string> = {
  clock_not_running: 'Время остановлено — нажатие не засчитано',
  undo_window_closed: 'Отмена уже невозможна (прошло 10 с после гонга)',
  nothing_to_undo: 'Нечего отменять',
  wrong_fight: 'Нажатие относится к прошлому бою',
  result_confirmed: 'Результат уже подтверждён',
  decision_not_needed: 'Решение не требуется',
  server_error: 'Сбой на сервере — нажатие сохранено и будет отправлено повторно',
  tap_too_old: 'Нажатие из очереди слишком старое (часы телефона сбились) — не засчитано',
};

/** Why taps made without a connection were refused once it was back. */
const queuedRefusals: Record<string, string> = {
  clock_not_running: 'Пока не было связи, время боя на сервере не шло (например, сервер был недоступен). Главный судья видит это у себя.',
  tap_too_old: 'Часы телефона сбились, пока не было связи.',
  wrong_fight: 'Они относились к прошлому бою.',
};

interface LostTaps {
  fightId: string;
  byReason: Record<string, number>;
}

/** Adds one refused offline tap; a new fight starts the count over. */
function addLostTap(l: LostTaps, fightId: string, reason: string): LostTaps {
  const byReason = l.fightId === fightId ? l.byReason : {};
  return { fightId, byReason: { ...byReason, [reason]: (byReason[reason] ?? 0) + 1 } };
}

/** A bar above the buttons (not over them, so no tap lands on it) listing the
 *  taps made without a connection that didn't count, and why. */
function LostTapsBar({ byReason, onDismiss }: { byReason: Record<string, number>; onDismiss: () => void }) {
  const reasons = Object.entries(byReason);
  const total = reasons.reduce((n, [, c]) => n + c, 0);
  if (total === 0) return null;
  return (
    <div className="bg-red-600 text-white px-3 py-2 flex items-center gap-3">
      <div className="flex-1 min-w-0 text-left">
        <div className="font-black text-sm">{total} нажат., сделанных без связи, не засчитаны</div>
        {reasons.map(([reason, n]) => (
          <div key={reason} className="text-xs">
            {reasons.length > 1 && `${n}: `}{queuedRefusals[reason] ?? refusals[reason] ?? `Отклонено: ${reason}`}
          </div>
        ))}
      </div>
      <button onClick={onDismiss} className="flex-shrink-0 px-4 py-1.5 bg-white text-red-700 rounded-lg font-black text-sm cursor-pointer">
        Понятно
      </button>
    </div>
  );
}

/** The line under the top bar: what the judge should expect, in words. */
function describePhase(phase: Phase, round: number, rounds: number, over: boolean): { text: string; tone: string } {
  if (over) return { text: 'Бой окончен', tone: 'bg-zinc-800 text-zinc-300' };
  const r = `Раунд ${Math.max(round, 1)} из ${rounds}`;
  switch (phase) {
    case 'RUNNING': return { text: `${r} · время идёт`, tone: 'bg-emerald-600 text-white' };
    case 'PAUSED': return { text: `${r} · время остановлено`, tone: 'bg-yellow-500 text-black' };
    case 'REST': return { text: `Перерыв после раунда ${round}`, tone: 'bg-cyan-700 text-white' };
    case 'ENDED': return { text: 'Бой окончен', tone: 'bg-zinc-800 text-zinc-300' };
    default: return { text: 'Ожидание начала боя', tone: 'bg-zinc-800 text-zinc-300' };
  }
}

function vibrate(ms: number) {
  if ('vibrate' in navigator) navigator.vibrate(ms);
}

export default function JudgeScreen({ view }: Props) {
  const { id } = useParams<{ id: string }>();
  const seat = Number(id);
  const me = view.judges.find(j => j.seat === seat);
  const { clock, result } = view;
  const connection = useConnection();
  // Until this page's own connection starts, the status is the previous page's.
  const mine = sameSession(connection.session, { role: 'judge', seat });
  const { pending } = connection;
  const status = mine ? connection.status : 'connecting';
  const [notice, setNotice] = useState('');
  // Taps made without a connection that the server refused once it was back,
  // counted per reason for the fight they arrived in. Stays on screen until
  // the judge dismisses it: they were told these taps would be sent, so a
  // 3-second toast isn't enough.
  const [lostTaps, setLostTaps] = useState<LostTaps>({ fightId: '', byReason: {} });
  const fightRef = useRef(view.fight_id);
  useEffect(() => { fightRef.current = view.fight_id; }, [view.fight_id]);

  useWakeLock(true);

  // Vibrate when the server confirms a tap, not on the tap itself (§3).
  useEffect(() => subscribeToResults((type, r) => {
    if (r.ok && type === 'REGISTER_HIT') vibrate(40);
    if (!r.ok && r.queued && type === 'REGISTER_HIT') {
      setLostTaps(l => addLostTap(l, fightRef.current, r.reason ?? ''));
      vibrate(200);
      return;
    }
    if (!r.ok && r.reason) {
      setNotice(refusals[r.reason] ?? `Отклонено: ${r.reason}`);
      vibrate(200);
    }
  }), []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  if (status === 'replaced') {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-6 bg-zinc-950 text-center p-6">
        <div className="text-white text-2xl font-black">Судья {seat} вошёл с другого устройства</div>
        <div className="text-zinc-400">Этот телефон отключён, чтобы нажатия не считались дважды.</div>
        <button onClick={reclaimSeat} className="px-6 py-3 bg-zinc-800 text-white rounded-xl font-bold cursor-pointer">
          Вернуть пульт на этот телефон
        </button>
      </div>
    );
  }

  if (!me) {
    const validSeat = seat >= 1 && seat <= 3;
    return (
      <div className="h-screen flex items-center justify-center bg-zinc-950 text-zinc-400 font-bold text-xl text-center p-6">
        {validSeat ? 'Подключение…' : 'Judge seat must be 1, 2 or 3 — open /judge/1, /judge/2 or /judge/3.'}
      </div>
    );
  }

  const isEnabled = clock.phase === 'RUNNING' && !result.final;
  // const canUndo = me.hits > 0 && !result.confirmed && clock.phase !== 'NOT_STARTED';
  const online = status === 'open';

  const phaseLine = describePhase(clock.phase, clock.round, clock.rounds, result.final);

  const handleHit = (corner: Corner) => {
    if (!isEnabled) return;
    sendAction('REGISTER_HIT', { corner, fight_id: view.fight_id });
  };

  return (
    <div className="h-screen w-full flex flex-col bg-zinc-950 overflow-hidden select-none">

      {!online && (
        <div className="bg-red-600 text-white font-black text-center py-2 flex items-center justify-center gap-2 z-30">
          <WifiOff size={18} /> Нет связи{pending > 0 ? ` — ${pending} нажат. сохранены и будут отправлены` : ''}
        </div>
      )}

      {/* Top bar: seat, my score (the undo button is hidden for now) */}
      <div className="h-14 flex items-center justify-between px-3 bg-zinc-900 border-b border-zinc-800 gap-2">
        <div className="text-base font-black tracking-widest text-zinc-400 uppercase whitespace-nowrap">
          Судья <span className="text-white">{seat}</span>
        </div>
        <div className="text-2xl font-black tabular-nums whitespace-nowrap">
          <span className="text-red-500">{me.total.red}</span>
          <span className="text-zinc-600 mx-2">:</span>
          <span className="text-blue-500">{me.total.blue}</span>
          {pending > 0 && online && <span className="text-xs text-zinc-500 ml-2">+{pending}…</span>}
        </div>
        {/* «Отменить» hidden for now at the club's request. Spec §3 still has the
            judge's undo; to bring it back, uncomment this, canUndo and Undo2.
        <button
          disabled={!canUndo}
          onClick={() => sendAction('UNDO_HIT', { fight_id: view.fight_id })}
          className="px-3 py-2 bg-zinc-800 disabled:opacity-30 rounded-lg text-zinc-200 font-bold text-sm flex items-center gap-1.5 cursor-pointer"
        >
          <Undo2 size={16} /> Отменить
        </button>
        */}
      </div>

      {/* What is happening now, in words */}
      <div className={`py-1.5 text-center text-sm font-black uppercase tracking-wider ${phaseLine.tone}`}>{phaseLine.text}</div>

      {lostTaps.fightId === view.fight_id && (
        <LostTapsBar byReason={lostTaps.byReason} onDismiss={() => setLostTaps({ fightId: '', byReason: {} })} />
      )}

      {/* Click-through, so a tap on the buttons under it is never swallowed. */}
      {notice && (
        <div className="pointer-events-none absolute top-20 inset-x-4 z-40 bg-yellow-500 text-black font-bold text-center rounded-xl py-3 px-4 shadow-xl">
          {notice}
        </div>
      )}

      {/* Judge decision (§6.4): totals and last round are equal, the judge must choose. */}
      {me.decision_needed && (
        <div className="absolute inset-0 z-50 bg-zinc-950 flex flex-col">
          <div className="text-center py-6 text-white text-2xl font-black uppercase tracking-widest">Решение судьи</div>
          <div className="text-center text-zinc-400 mb-4 px-6">Счёт равный. Выберите победителя.</div>
          <div className="flex-1 flex">
            <button
              onClick={() => sendAction('JUDGE_DECISION', { corner: 'Red', fight_id: view.fight_id })}
              className="flex-1 min-w-0 px-2 break-words bg-red-600 active:bg-red-700 text-white text-3xl sm:text-5xl font-black cursor-pointer touch-manipulation"
            >
              {view.red_name || 'RED'}
            </button>
            <div className="w-1.5 bg-zinc-950" />
            <button
              onClick={() => sendAction('JUDGE_DECISION', { corner: 'Blue', fight_id: view.fight_id })}
              className="flex-1 min-w-0 px-2 break-words bg-blue-600 active:bg-blue-700 text-white text-3xl sm:text-5xl font-black cursor-pointer touch-manipulation"
            >
              {view.blue_name || 'BLUE'}
            </button>
          </div>
        </div>
      )}

      {result.final && (
        <div className="absolute inset-0 z-40 bg-zinc-950/90 flex flex-col items-center justify-center">
          <div className="text-zinc-400 text-xl font-bold uppercase tracking-widest mb-4">Бой окончен</div>
          {me.verdict && <div className={`text-4xl font-black ${me.verdict === 'Red' ? 'text-red-500' : 'text-blue-500'}`}>Ваш голос: {me.verdict === 'Red' ? 'КРАСНЫЙ' : 'СИНИЙ'}</div>}
          {!result.confirmed && <div className="text-zinc-500 mt-4">Ожидается подтверждение оператора</div>}
        </div>
      )}

      {/* Main Buttons */}
      <div className="flex-1 flex w-full relative">
        <button
          disabled={!isEnabled}
          onPointerDown={() => handleHit('Red')}
          className="flex-1 min-w-0 bg-gradient-to-b from-red-600 to-red-700 disabled:opacity-50 disabled:grayscale transition-transform btn-active-scale flex flex-col items-center justify-center relative shadow-[inset_0_4px_30px_rgba(255,255,255,0.2)] active:shadow-[inset_0_10px_50px_rgba(0,0,0,0.4)] touch-manipulation cursor-pointer"
        >
          {view.red_name && (
            <div className="text-white/80 text-base sm:text-lg font-bold mb-1 px-2 break-words">{view.red_name}</div>
          )}
          <div className="text-white font-black text-3xl sm:text-6xl tracking-wide opacity-90">КРАСНЫЙ</div>
        </button>

        <div className="w-1.5 h-full bg-zinc-950 z-20"></div>

        <button
          disabled={!isEnabled}
          onPointerDown={() => handleHit('Blue')}
          className="flex-1 min-w-0 bg-gradient-to-b from-blue-600 to-blue-700 disabled:opacity-50 disabled:grayscale transition-transform btn-active-scale flex flex-col items-center justify-center relative shadow-[inset_0_4px_30px_rgba(255,255,255,0.2)] active:shadow-[inset_0_10px_50px_rgba(0,0,0,0.4)] touch-manipulation cursor-pointer"
        >
          {view.blue_name && (
            <div className="text-white/80 text-base sm:text-lg font-bold mb-1 px-2 break-words">{view.blue_name}</div>
          )}
          <div className="text-white font-black text-3xl sm:text-6xl tracking-wide opacity-90">СИНИЙ</div>
        </button>
      </div>
    </div>
  );
}
