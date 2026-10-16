import type { FightView } from '../../api/protocol';
import ScoreDiffBar from '../../shared/ScoreDiffBar';
import { winnerTextColor } from '../../shared/fightText';

/** One row per judge: connection, running score, difference bar and verdict. */
export default function JudgeCards({ view }: { view: FightView }) {
  return (
    <div className="w-full flex flex-col gap-2">
      {view.judges.map(judge => {
        const diff = judge.total.red - judge.total.blue;
        return (
          <div key={judge.seat} className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 px-4 flex items-center gap-4">
            <div className="w-24 text-center flex-shrink-0 border-r border-zinc-800 pr-4">
              <div className="text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${judge.connected ? 'bg-emerald-400' : 'bg-red-500 animate-pulse'}`} title={judge.connected ? 'connected' : 'disconnected'} />
                JUDGE <span className="text-zinc-500 text-base">{judge.seat}</span>
              </div>
              {judge.decision_needed && <div className="text-[10px] text-yellow-400 font-bold uppercase animate-pulse">Deciding…</div>}
              {judge.verdict && (
                <div className={`text-[11px] font-black uppercase ${winnerTextColor(judge.verdict)}`}>
                  {judge.verdict}{judge.decided ? ' (decision)' : ''}
                </div>
              )}
            </div>
            <div className="w-16 text-center flex-shrink-0">
              <div className="text-red-500 text-[10px] font-bold uppercase tracking-widest">Red</div>
              <div className="text-white text-4xl font-black leading-none">{judge.total.red}</div>
            </div>
            <div className="flex-1 flex flex-col justify-center bg-zinc-950/40 rounded-lg px-3 py-1.5 border border-zinc-800/50">
              <div className="flex items-center justify-between mb-1 text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                <span>{judge.rounds.map((r, i) => `R${i + 1} ${r.red}:${r.blue}`).join('  ·  ')}</span>
                <span>{diff === 0 ? 'EVEN' : `DIFF ${Math.abs(diff)}`}</span>
              </div>
              <ScoreDiffBar diff={diff} />
            </div>
            <div className="w-16 text-center flex-shrink-0">
              <div className="text-blue-500 text-[10px] font-bold uppercase tracking-widest">Blue</div>
              <div className="text-white text-4xl font-black leading-none">{judge.total.blue}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
