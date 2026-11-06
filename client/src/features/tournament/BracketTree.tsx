import type { ReactElement } from 'react';
import type { Bracket, BracketMatch } from '../../api/protocol';
import { Crown, Swords } from 'lucide-react';

// Classic left-to-right tournament tree: round 1 on the far left, the final on
// the right, then the champion. Cards sit in an SVG so connector lines line up.

export interface BracketTreeProps {
  bracket: Bracket;
  activeBracketMatchId: string;
  onStartMatch: (matchId: string) => void;
  onWalkover: (match: BracketMatch) => void;
  onCorrect: (match: BracketMatch) => void;
  onOpenRing: () => void;
}

const CARD_W = 230;
const ROW_H = 36;      // one fighter row
const FOOT_H = 30;     // the card's action row
const CARD_H = 2 * ROW_H + FOOT_H + 2;
const GAP = 10;        // between sibling cards in round 1
const COL_GAP = 48;    // between round columns
const LABEL_H = 28;    // round label row
const STROKE = '#3f3f46';

function roundLabel(round: number, totalRounds: number) {
  if (round === totalRounds) return 'Final';
  if (round === totalRounds - 1) return 'Semi-final';
  if (round === totalRounds - 2) return 'Quarter-final';
  return `Round of ${2 ** (totalRounds - round + 1)}`;
}

export default function BracketTree({ bracket, activeBracketMatchId, onStartMatch, onWalkover, onCorrect, onOpenRing }: BracketTreeProps) {
  const totalRounds = bracket.total_rounds;
  const byRound = (r: number) => bracket.matches.filter(m => m.round === r).sort((a, b) => a.position - b.position);

  // Each round up doubles the distance between sibling cards.
  const spacing = (round: number) => GAP + (CARD_H + GAP) * (2 ** (round - 1) - 1);
  const colHeight = (round: number) => {
    const n = byRound(round).length || 1;
    return n * CARD_H + (n - 1) * spacing(round);
  };
  const maxH = Math.max(...Array.from({ length: totalRounds }, (_, i) => colHeight(i + 1)));
  const top = (round: number) => LABEL_H + (maxH - colHeight(round)) / 2;
  const cardY = (round: number, i: number) => top(round) + i * (CARD_H + spacing(round));
  const colX = (round: number) => (round - 1) * (CARD_W + COL_GAP);

  const elements: ReactElement[] = [];
  for (let round = 1; round <= totalRounds; round++) {
    const matches = byRound(round);
    const x = colX(round);

    elements.push(
      <foreignObject key={`lbl-${round}`} x={x} y={0} width={CARD_W} height={LABEL_H}>
        <div className={`text-[11px] font-bold uppercase tracking-widest text-center leading-7 ${round === totalRounds ? 'text-amber-500' : 'text-zinc-500'}`}>
          {roundLabel(round, totalRounds)}
        </div>
      </foreignObject>,
    );

    matches.forEach((match, i) => {
      elements.push(
        <foreignObject key={match.id} x={x} y={cardY(round, i)} width={CARD_W} height={CARD_H}>
          <MatchCard
            match={match}
            isActive={activeBracketMatchId === match.id}
            onStart={() => onStartMatch(match.id)}
            onWalkover={() => onWalkover(match)}
            onCorrect={() => onCorrect(match)}
            onOpenRing={onOpenRing}
          />
        </foreignObject>,
      );
    });

    if (round === totalRounds) continue;
    const nextCount = byRound(round + 1).length;
    const xRight = x + CARD_W;
    const xMid = xRight + COL_GAP / 2;
    for (let i = 0; i < matches.length; i += 2) {
      const parent = i / 2;
      if (parent >= nextCount) continue;
      const y1 = cardY(round, i) + CARD_H / 2;
      const y2 = i + 1 < matches.length ? cardY(round, i + 1) + CARD_H / 2 : y1;
      const yNext = cardY(round + 1, parent) + CARD_H / 2;
      elements.push(
        <g key={`conn-${round}-${i}`} stroke={STROKE} strokeWidth="1.5" strokeLinecap="round">
          <line x1={xRight} y1={y1} x2={xMid} y2={y1} />
          <line x1={xRight} y1={y2} x2={xMid} y2={y2} />
          <line x1={xMid} y1={y1} x2={xMid} y2={y2} />
          <line x1={xMid} y1={(y1 + y2) / 2} x2={xRight + COL_GAP} y2={yNext} />
        </g>,
      );
    }
  }

  // Champion box to the right of the final.
  const final = byRound(totalRounds)[0];
  const champion = final?.status === 'COMPLETED' && final.winner_id
    ? (final.winner_id === final.fighter_red_id ? final.fighter_red_name : final.fighter_blue_name)
    : '';
  const treeW = colX(totalRounds) + CARD_W;
  const champX = treeW + COL_GAP;
  const champW = 180;
  const finalY = cardY(totalRounds, 0);
  elements.push(
    <line key="champ-conn" x1={treeW} y1={finalY + CARD_H / 2} x2={champX} y2={finalY + CARD_H / 2} stroke={STROKE} strokeWidth="1.5" />,
    <foreignObject key="champion" x={champX} y={finalY} width={champW} height={CARD_H}>
      <div className={`h-full rounded-xl flex flex-col items-center justify-center px-3 ${champion ? 'bg-amber-950/40 border-2 border-amber-600/60' : 'border border-zinc-800 opacity-40'}`}>
        <Crown size={18} className={champion ? 'text-amber-400' : 'text-zinc-600'} />
        <div className={`text-[10px] font-bold uppercase tracking-[0.2em] ${champion ? 'text-amber-400' : 'text-zinc-600'}`}>Champion</div>
        {champion && <div className="text-white text-sm font-black truncate max-w-full">{champion}</div>}
      </div>
    </foreignObject>,
  );

  const width = champX + champW;
  const height = maxH + LABEL_H + 8;
  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="block" style={{ minWidth: width }}>
        {elements}
      </svg>
    </div>
  );
}

function FighterRow({ name, corner, won, lost }: { name: string; corner: 'red' | 'blue'; won: boolean; lost: boolean }) {
  const real = !!name && name !== 'Bye';
  return (
    <div style={{ height: ROW_H }} className={`flex items-center gap-2 px-3 ${won ? (corner === 'red' ? 'bg-red-900/25' : 'bg-blue-900/25') : ''} ${lost ? 'opacity-40' : ''}`}>
      <div className={`w-1.5 h-5 rounded-full flex-shrink-0 ${!real ? 'bg-zinc-700' : corner === 'red' ? 'bg-red-500' : 'bg-blue-500'}`} />
      <div className={`flex-1 min-w-0 text-sm font-bold truncate ${real ? 'text-white' : 'text-zinc-600'}`}>{name || 'TBD'}</div>
      {won && <Crown size={14} className="text-amber-400 flex-shrink-0" />}
    </div>
  );
}

/** A match: both fighters and one action row that says what can be done with it now. */
function MatchCard({ match, isActive, onStart, onWalkover, onCorrect, onOpenRing }: {
  match: BracketMatch;
  isActive: boolean;
  onStart: () => void;
  onWalkover: () => void;
  onCorrect: () => void;
  onOpenRing: () => void;
}) {
  const completed = match.status === 'COMPLETED';
  const bye = match.status === 'BYE';
  const ready = !!match.fighter_red_id && !!match.fighter_blue_id && match.status === 'PENDING';
  const redWon = completed && match.winner_id === match.fighter_red_id;
  const blueWon = completed && match.winner_id === match.fighter_blue_id;
  const foot = 'flex-1 h-full text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer';

  return (
    <div className={`h-full rounded-xl border overflow-hidden flex flex-col ${isActive ? 'border-emerald-500/70 bg-zinc-900' : bye ? 'border-zinc-800/60 bg-zinc-900/40' : 'border-zinc-700/70 bg-zinc-900'}`}>
      <FighterRow name={match.fighter_red_name || (bye ? 'Bye' : '')} corner="red" won={redWon} lost={completed && !redWon} />
      <div className="border-t border-zinc-800/60" />
      <FighterRow name={match.fighter_blue_name || (bye ? 'Bye' : '')} corner="blue" won={blueWon} lost={completed && !blueWon} />
      <div style={{ height: FOOT_H }} className="flex border-t border-zinc-800/60 text-zinc-500">
        {isActive ? (
          <button onClick={onOpenRing} className={`${foot} bg-emerald-600/25 text-emerald-300 hover:bg-emerald-600/40`}>● On the ring — open</button>
        ) : ready ? (
          <>
            <button onClick={onStart} className={`${foot} bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/40`}><Swords size={12} /> Start fight</button>
            <button onClick={onWalkover} title="Opponent did not show: win by walkover" className="px-3 h-full text-[11px] font-bold border-l border-zinc-800/60 hover:text-white hover:bg-zinc-800 cursor-pointer">WO</button>
          </>
        ) : completed ? (
          <>
            <span className="flex-1 px-3 flex items-center text-[11px] font-bold uppercase text-zinc-400">
              {match.method}{match.votes ? ` ${match.votes}` : ''}{match.corrections?.length ? ' · corrected' : ''}
            </span>
            <button onClick={onCorrect} className="px-3 h-full text-[11px] font-bold border-l border-zinc-800/60 hover:text-amber-400 hover:bg-zinc-800 cursor-pointer">Correct…</button>
          </>
        ) : (
          <span className="flex-1 flex items-center justify-center text-[11px] font-bold uppercase">{bye ? 'Passes without a fight' : 'Waiting for fighters'}</span>
        )}
      </div>
    </div>
  );
}
