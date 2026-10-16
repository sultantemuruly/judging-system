import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { reclaimSeat, sendAction, subscribeToResults } from '../../api/socket';
import type { Corner, FightView } from '../../api/protocol';
import { useConnection } from '../../shared/useConnection';
import { useWakeLock } from './useWakeLock';
import { Undo2, WifiOff } from 'lucide-react';

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
};

function vibrate(ms: number) {
  if ('vibrate' in navigator) navigator.vibrate(ms);
}

export default function JudgeScreen({ view }: Props) {
  const { id } = useParams<{ id: string }>();
  const seat = Number(id);
  const me = view.judges.find(j => j.seat === seat);
  const { clock, result } = view;
  const { status, pending } = useConnection();
  const [notice, setNotice] = useState('');

  useWakeLock(true);

  // Vibrate when the server confirms a tap, not on the tap itself (§3).
  useEffect(() => subscribeToResults((type, r) => {
    if (r.ok && type === 'REGISTER_HIT') vibrate(40);
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
  const canUndo = me.hits > 0 && !result.confirmed && clock.phase !== 'NOT_STARTED';
  const online = status === 'open';

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

      {/* Top Bar */}
      <div className="h-16 flex items-center justify-between px-4 bg-zinc-900 shadow-md z-10 border-b border-zinc-800 gap-3">
        <div className="text-lg font-black tracking-widest text-zinc-400 uppercase whitespace-nowrap">
          СУДЬЯ <span className="text-white ml-1">{seat}</span>
        </div>
        <div className="text-2xl font-black tabular-nums whitespace-nowrap">
          <span className="text-red-500">К {me.total.red}</span>
          <span className="text-zinc-600 mx-2">:</span>
          <span className="text-blue-500">С {me.total.blue}</span>
          {pending > 0 && online && <span className="text-xs text-zinc-500 ml-2">+{pending}…</span>}
        </div>
        <div className="flex items-center gap-3">
          <button
            disabled={!canUndo}
            onClick={() => sendAction('UNDO_HIT', { fight_id: view.fight_id })}
            className="px-3 py-2 bg-zinc-800 disabled:opacity-30 rounded-lg text-zinc-200 font-bold text-sm flex items-center gap-1.5 cursor-pointer"
          >
            <Undo2 size={16} /> Отменить
          </button>
          <div className="px-3 py-1 bg-zinc-800 rounded-full text-xs font-bold text-zinc-300 whitespace-nowrap">
            Р{Math.max(clock.round, 1)} · {clock.phase === 'RUNNING' ? 'ИДЁТ' : clock.phase === 'PAUSED' ? 'СТОП' : clock.phase === 'REST' ? 'ПЕРЕРЫВ' : clock.phase === 'ENDED' ? 'КОНЕЦ' : 'ОЖИДАНИЕ'}
          </div>
        </div>
      </div>

      {notice && (
        <div className="absolute top-20 inset-x-4 z-40 bg-yellow-500 text-black font-bold text-center rounded-xl py-3 px-4 shadow-xl">
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
              className="flex-1 bg-red-600 active:bg-red-700 text-white text-5xl font-black cursor-pointer touch-manipulation"
            >
              {view.red_name || 'RED'}
            </button>
            <div className="w-1.5 bg-zinc-950" />
            <button
              onClick={() => sendAction('JUDGE_DECISION', { corner: 'Blue', fight_id: view.fight_id })}
              className="flex-1 bg-blue-600 active:bg-blue-700 text-white text-5xl font-black cursor-pointer touch-manipulation"
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
          className="flex-1 bg-gradient-to-b from-red-600 to-red-700 disabled:opacity-50 disabled:grayscale transition-transform btn-active-scale flex flex-col items-center justify-center relative shadow-[inset_0_4px_30px_rgba(255,255,255,0.2)] active:shadow-[inset_0_10px_50px_rgba(0,0,0,0.4)] touch-manipulation cursor-pointer"
        >
          {view.red_name && (
            <div className="text-white/70 text-lg font-bold tracking-wider mb-1 drop-shadow-md">{view.red_name}</div>
          )}
          <div className="text-white font-black text-6xl tracking-widest drop-shadow-md opacity-80">КРАСНЫЙ</div>
        </button>

        <div className="w-1.5 h-full bg-zinc-950 z-20"></div>

        <button
          disabled={!isEnabled}
          onPointerDown={() => handleHit('Blue')}
          className="flex-1 bg-gradient-to-b from-blue-600 to-blue-700 disabled:opacity-50 disabled:grayscale transition-transform btn-active-scale flex flex-col items-center justify-center relative shadow-[inset_0_4px_30px_rgba(255,255,255,0.2)] active:shadow-[inset_0_10px_50px_rgba(0,0,0,0.4)] touch-manipulation cursor-pointer"
        >
          {view.blue_name && (
            <div className="text-white/70 text-lg font-bold tracking-wider mb-1 drop-shadow-md">{view.blue_name}</div>
          )}
          <div className="text-white font-black text-6xl tracking-widest drop-shadow-md opacity-80">СИНИЙ</div>
        </button>
      </div>
    </div>
  );
}
