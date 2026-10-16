import { useParams } from 'react-router-dom';
import { sendAction } from './socket';
import type { Corner, FightView } from './api/protocol';

interface Props {
  view: FightView;
}

export default function JudgeScreen({ view }: Props) {
  const { id } = useParams<{ id: string }>();
  const seat = Number(id);
  const me = view.judges.find(j => j.seat === seat);
  const { clock, result } = view;

  if (!me) {
    const validSeat = seat >= 1 && seat <= 3;
    return (
      <div className="h-screen flex items-center justify-center bg-zinc-950 text-zinc-400 font-bold text-xl text-center p-6">
        {validSeat ? 'Подключение…' : 'Judge seat must be 1, 2 or 3 — open /judge/1, /judge/2 or /judge/3.'}
      </div>
    );
  }

  const isEnabled = clock.phase === 'RUNNING' && !result.final;

  const handleHit = (corner: Corner) => {
    if (!isEnabled) return;
    if ('vibrate' in navigator) navigator.vibrate(50);
    sendAction('REGISTER_HIT', { seat, corner });
  };

  return (
    <div className="h-screen w-full flex flex-col bg-zinc-950 overflow-hidden select-none">

      {/* Top Bar */}
      <div className="h-16 flex items-center justify-between px-6 bg-zinc-900 shadow-md z-10 border-b border-zinc-800">
        <div className="text-lg font-black tracking-widest text-zinc-400 uppercase">
          JUDGE <span className="text-white ml-2">{seat}</span>
        </div>
        <div className="text-2xl font-black tabular-nums">
          <span className="text-red-500">К {me.total.red}</span>
          <span className="text-zinc-600 mx-2">:</span>
          <span className="text-blue-500">С {me.total.blue}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm font-bold text-zinc-500 tracking-widest uppercase">
            ROUND <span className="text-white ml-1">{Math.max(clock.round, 1)}</span>
          </div>
          <div className="px-3 py-1 bg-zinc-800 rounded-full text-xs font-bold text-zinc-300">
            {clock.phase.replace('_', ' ')}
          </div>
        </div>
      </div>

      {/* Judge decision (§6.4): totals and last round are equal, the judge must choose. */}
      {me.decision_needed && (
        <div className="absolute inset-0 z-50 bg-zinc-950 flex flex-col">
          <div className="text-center py-6 text-white text-2xl font-black uppercase tracking-widest">Решение судьи</div>
          <div className="text-center text-zinc-400 mb-4 px-6">Счёт равный. Выберите победителя.</div>
          <div className="flex-1 flex">
            <button
              onClick={() => sendAction('JUDGE_DECISION', { seat, corner: 'Red' })}
              className="flex-1 bg-red-600 active:bg-red-700 text-white text-5xl font-black cursor-pointer touch-manipulation"
            >
              {view.red_name || 'RED'}
            </button>
            <div className="w-1.5 bg-zinc-950" />
            <button
              onClick={() => sendAction('JUDGE_DECISION', { seat, corner: 'Blue' })}
              className="flex-1 bg-blue-600 active:bg-blue-700 text-white text-5xl font-black cursor-pointer touch-manipulation"
            >
              {view.blue_name || 'BLUE'}
            </button>
          </div>
        </div>
      )}

      {result.final && (
        <div className="absolute inset-0 z-40 bg-zinc-950/90 flex flex-col items-center justify-center">
          <div className="text-zinc-400 text-xl font-bold uppercase tracking-widest mb-4">Fight Over</div>
          <div className={`text-5xl font-black uppercase ${result.winner === 'Red' ? 'text-red-500' : 'text-blue-500'}`}>
            {result.winner} ({result.method})
          </div>
          {me.verdict && <div className="text-zinc-400 mt-4">Your verdict: {me.verdict}</div>}
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
          <div className="text-white font-black text-6xl tracking-widest drop-shadow-md opacity-80">RED</div>
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
          <div className="text-white font-black text-6xl tracking-widest drop-shadow-md opacity-80">BLUE</div>
        </button>
      </div>
    </div>
  );
}
