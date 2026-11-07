import type { ReactNode } from 'react';
import type { FightView } from '../../api/protocol';
import { cornerName, resultLabel, winnerTextColor } from '../../shared/fightText';
import { publicView } from '../../shared/publicView';
import ActionLog from '../operator/ActionLog';
import FightClock from '../operator/FightClock';
import JudgeCards from '../operator/JudgeCards';
import RefereeActions from '../operator/RefereeActions';

/**
 * /board: the operator's ring view, read-only and open without a login, for a
 * big screen in the hall. Like /viewer, it names the winner only once the
 * operator has confirmed the result (§7): it renders publicView, not the
 * operator's full view.
 */
export default function BoardScreen({ view: full }: { view: FightView }) {
  const view = publicView(full);
  const { result } = view;
  const showScores = view.live_scores || (result.final && result.confirmed);
  return (
    <div className="min-h-screen lg:h-screen w-full flex flex-col items-center bg-zinc-950 lg:overflow-hidden">
      <header className="w-full flex items-center justify-between px-4 h-14 border-b border-zinc-800 flex-shrink-0">
        <h1 className="text-lg font-black text-white tracking-widest uppercase">
          Kickboxing <span className="text-zinc-500 font-light">Live</span>
        </h1>
      </header>

      <div className="flex-1 w-full max-w-7xl flex flex-col lg:flex-row gap-4 min-h-0 p-3 sm:p-4">
        <div className="flex-1 flex flex-col gap-4 min-h-0 lg:overflow-y-auto">
          <FightClock view={view} />
          <RefereeActions view={view} />
          {showScores && <JudgeCards view={view} />}
        </div>
        <div className="lg:w-80 flex flex-col gap-3 min-h-0">
          <BoardResult view={view} />
          <ActionLog view={view} readOnly />
        </div>
      </div>
    </div>
  );
}

function BoardResult({ view }: { view: FightView }) {
  const { result, clock } = view;
  if (!result.final) {
    if (clock.phase !== 'ENDED') return null;
    return <Card tone="border-yellow-600/50"><Title className="text-yellow-400">Waiting for the judges' decision</Title></Card>;
  }
  if (!result.confirmed) {
    return <Card tone="border-zinc-700"><Title className="text-zinc-300 animate-pulse">Decision pending…</Title></Card>;
  }
  return (
    <Card tone="border-emerald-700/60">
      <div className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Winner</div>
      <div className={`text-3xl font-black uppercase mt-1 ${winnerTextColor(result.winner)}`}>{cornerName(view, result.winner)}</div>
      <div className="text-zinc-300 font-bold text-sm mt-1">{resultLabel(result)}</div>
    </Card>
  );
}

function Card({ tone, children }: { tone: string; children: ReactNode }) {
  return <div className={`bg-zinc-900 border-2 rounded-xl p-4 text-center ${tone}`}>{children}</div>;
}

function Title({ className, children }: { className: string; children: ReactNode }) {
  return <div className={`font-black uppercase tracking-wider text-sm ${className}`}>{children}</div>;
}
