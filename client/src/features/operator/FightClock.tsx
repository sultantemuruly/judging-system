import type { FightView } from '../../api/protocol';
import { formatMs } from '../../shared/fightText';
import { useCountdown, useRemaining } from '../../shared/useCountdown';

const MEDICAL_MS = 120_000;

export default function FightClock({ view }: { view: FightView }) {
  const { clock, medical } = view;
  const { remainingMs, isRest, secondsOut } = useCountdown(clock);
  const medicalLeft = useRemaining(medical.active ? medical.ends_at : 0, MEDICAL_MS);

  return (
    <div className="text-center flex-shrink-0">
      {(view.red_name || view.blue_name) && (
        <div className="mb-1">
          {view.category && (
            <div className="text-zinc-400 text-sm font-black uppercase tracking-[0.2em] mb-1">{view.category}</div>
          )}
          <div className="flex items-center justify-center gap-6">
            <div className="text-right flex-1 text-red-500 text-4xl font-black uppercase tracking-tight leading-none">{view.red_name || 'RED'}</div>
            <div className="text-zinc-600 font-black text-2xl flex-shrink-0">VS</div>
            <div className="text-left flex-1 text-blue-500 text-4xl font-black uppercase tracking-tight leading-none">{view.blue_name || 'BLUE'}</div>
          </div>
        </div>
      )}
      <div className="flex items-end justify-center gap-4 mt-2">
        <div className="text-zinc-400 text-xl uppercase tracking-widest font-black pb-2 text-right w-28">R{Math.max(clock.round, 1)}/{clock.rounds}</div>
        <div className="text-7xl md:text-8xl font-black text-white font-mono tracking-tighter leading-none">{formatMs(remainingMs)}</div>
        <div className={`text-sm font-black pb-2 uppercase w-28 text-left ${secondsOut ? 'text-orange-400 animate-pulse' : isRest ? 'text-cyan-400 animate-pulse' : 'text-zinc-500'}`}>
          {secondsOut ? 'SECONDS OUT' : isRest ? 'REST' : clock.phase.replace('_', ' ')}
        </div>
      </div>
      {medical.active && (
        <div className="mt-2 inline-flex items-center gap-3 bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 rounded-xl px-4 py-1.5 font-black">
          MEDICAL TIMEOUT <span className="font-mono text-2xl text-white">{formatMs(medicalLeft)}</span>
        </div>
      )}
    </div>
  );
}
