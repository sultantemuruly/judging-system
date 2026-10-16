import type { ReactElement } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { TournamentState, BracketMatch, Bracket, WeightCategory } from '../../api/protocol';
import { sendAction } from '../../api/socket';
import { ArrowLeft, Crown, Lock, Medal, Printer, RotateCcw, Swords } from 'lucide-react';
import BracketBoard from './BracketBoard';

interface Props {
  tournament: TournamentState;
}

export default function BracketView({ tournament }: Props) {
  const { categoryId } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();

  const category = tournament.categories.find(c => c.id === categoryId);
  const bracket = categoryId ? tournament.brackets?.[categoryId] : null;

  if (!category || !bracket || !bracket.generated) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-zinc-500 text-lg font-bold mb-4">Bracket not found or not generated yet</div>
          <button
            onClick={() => navigate('/tournament/setup')}
            className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-bold rounded-xl transition-all flex items-center gap-2 mx-auto cursor-pointer"
          >
            <ArrowLeft size={16} /> Back to Setup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/tournament/setup')}
              className="p-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-all cursor-pointer"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-2xl font-black text-white tracking-wider uppercase">
                {category.name}{' '}
                <span className="text-zinc-500 font-light">
                  {[category.sex, category.gender, category.discipline].filter(Boolean).join(' · ')}
                </span>
              </h1>
              <p className="text-xs text-zinc-500 font-medium mt-0.5">
                {category.fighters?.length || 0} fighters · {bracket.total_rounds} rounds
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Placings bracket={bracket} category={category} />
            <button
              onClick={() => navigate(`/tournament/print/${categoryId}`)}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-bold rounded-xl transition-all flex items-center gap-2 border border-zinc-700 cursor-pointer"
            >
              <Printer size={14} /> Print / PDF
            </button>
            {bracket.locked ? (
              <span className="px-3 py-2 text-xs font-bold text-zinc-500 flex items-center gap-1.5" title="A fight was decided: the bracket can no longer be regenerated">
                <Lock size={13} /> Locked
              </span>
            ) : (
              <button
                onClick={() => {
                  if (window.confirm('Are you sure you want to regenerate this bracket? All current matches will be lost.')) {
                    sendAction('GENERATE_BRACKET', { category_id: categoryId });
                  }
                }}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-bold rounded-xl transition-all flex items-center gap-2 border border-zinc-700 cursor-pointer"
              >
                <RotateCcw size={14} /> Regenerate
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bracket */}
      <div className="p-6 overflow-x-auto">
        <BracketBoard tournament={tournament} category={category} bracket={bracket} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SymmetricBracketTree — exported so AllBracketsView can reuse it
//
// Layout: classic left-to-right tournament tree.
// Round 1 is on the far left (most matches), Final is on the far right.
// Connector lines form the classic bracket tree shape.
// ─────────────────────────────────────────────────────────────────────────────

export interface SymmetricBracketTreeProps {
  bracket: Bracket;
  category: WeightCategory;
  activeBracketMatchId: string;
  onStartMatch: (matchId: string) => void;
  onWalkover: (match: BracketMatch) => void;
  onCorrect: (match: BracketMatch) => void;
}

export function SymmetricBracketTree({
  bracket,
  activeBracketMatchId,
  onStartMatch,
  onWalkover,
  onCorrect,
}: SymmetricBracketTreeProps) {
  const totalRounds = bracket.total_rounds;

  // Group matches by round (1-indexed), sorted by position
  const matchesByRound: Record<number, BracketMatch[]> = {};
  for (let r = 1; r <= totalRounds; r++) {
    matchesByRound[r] = bracket.matches
      .filter(m => m.round === r)
      .sort((a, b) => a.position - b.position);
  }

  const finalMatch = matchesByRound[totalRounds]?.[0];

  const getRoundLabel = (round: number) => {
    if (round === totalRounds) return 'Final';
    if (round === totalRounds - 1) return 'Semi-Final';
    if (round === totalRounds - 2) return 'Quarter-Final';
    const total = (matchesByRound[round]?.length || 1) * 2;
    return `Round of ${total}`;
  };

  // ── Layout constants ──────────────────────────────────────────────────────
  const CARD_W = 220;    // match card width
  const CARD_H = 88;     // match card height
  const GAP = 8;         // minimum gap between sibling cards
  const COL_GAP = 48;    // horizontal gap between round columns
  const LABEL_H = 28;    // height of the round label row

  // For a given round, compute the vertical spacing between adjacent match cards.
  // In a bracket tree, each round up doubles the gap between siblings.
  const spacingForRound = (round: number) => {
    if (round === 1) return GAP;
    // Each level up: gap = CARD_H + 2*prevSpacing + GAP (standard bracket doubling)
    return GAP + (CARD_H + GAP) * (Math.pow(2, round - 1) - 1);
  };

  // Height of a column for a given round
  const colHeight = (round: number) => {
    const n = matchesByRound[round]?.length || 1;
    const spacing = spacingForRound(round);
    return n * CARD_H + (n - 1) * spacing;
  };

  // Canvas dimensions
  const maxH = Math.max(...Array.from({ length: totalRounds }, (_, i) => colHeight(i + 1)));
  const canvasH = maxH + LABEL_H + 20; // padding
  const canvasW = totalRounds * (CARD_W + COL_GAP) - COL_GAP;

  const S = '#3f3f46'; // connector stroke colour

  // Build all columns + connectors
  const elements: ReactElement[] = [];

  for (let round = 1; round <= totalRounds; round++) {
    const matches = matchesByRound[round] || [];
    const spacing = spacingForRound(round);
    const cH = colHeight(round);
    const xBase = (round - 1) * (CARD_W + COL_GAP);
    const top = LABEL_H + (maxH - cH) / 2;

    // Round label
    elements.push(
      <foreignObject key={`lbl-${round}`} x={xBase} y={0} width={CARD_W} height={LABEL_H}>
        <div
          className={`text-[10px] font-bold uppercase tracking-widest text-center ${round === totalRounds ? 'text-amber-500/80' : 'text-zinc-500'}`}
          style={{ lineHeight: `${LABEL_H}px` }}
        >
          {getRoundLabel(round)}
        </div>
      </foreignObject>
    );

    // Match cards
    matches.forEach((match, i) => {
      const y = top + i * (CARD_H + spacing);
      elements.push(
        <foreignObject key={match.id} x={xBase} y={y} width={CARD_W} height={CARD_H}>
          <MatchCard
            match={match}
            isActive={activeBracketMatchId === match.id}
            onStart={() => onStartMatch(match.id)}
            onWalkover={() => onWalkover(match)}
            onCorrect={() => onCorrect(match)}
          />
        </foreignObject>
      );
    });

    // Connector lines from this round to the next
    if (round < totalRounds) {
      const nextSpacing = spacingForRound(round + 1);
      const nextMatches = matchesByRound[round + 1] || [];
      const nextCH = colHeight(round + 1);
      const nextTop = LABEL_H + (maxH - nextCH) / 2;
      const xRight = xBase + CARD_W;
      const xMid = xBase + CARD_W + COL_GAP / 2;
      const xNext = xBase + CARD_W + COL_GAP;

      for (let i = 0; i < matches.length; i += 2) {
        const y1 = top + i * (CARD_H + spacing) + CARD_H / 2;
        const hasPair = i + 1 < matches.length;
        const y2 = hasPair ? top + (i + 1) * (CARD_H + spacing) + CARD_H / 2 : y1;
        const midY = (y1 + y2) / 2;

        const parentIdx = Math.floor(i / 2);
        const nextY = nextTop + parentIdx * (CARD_H + nextSpacing) + CARD_H / 2;
        // If next round has fewer matches than expected (bye), next card may not exist
        const hasNext = parentIdx < nextMatches.length;
        if (!hasNext) continue;

        elements.push(
          <g key={`conn-r${round}-i${i}`}>
            {/* Horizontal stub right from match 1 */}
            <line x1={xRight} y1={y1} x2={xMid} y2={y1} stroke={S} strokeWidth="1.5" strokeLinecap="round" />
            {hasPair && (
              <>
                {/* Horizontal stub right from match 2 */}
                <line x1={xRight} y1={y2} x2={xMid} y2={y2} stroke={S} strokeWidth="1.5" strokeLinecap="round" />
                {/* Vertical bar connecting the two stubs */}
                <line x1={xMid} y1={y1} x2={xMid} y2={y2} stroke={S} strokeWidth="1.5" strokeLinecap="round" />
              </>
            )}
            {/* Horizontal line from midpoint to next card */}
            <line x1={xMid} y1={midY} x2={xNext} y2={nextY} stroke={S} strokeWidth="1.5" strokeLinecap="round" />
          </g>
        );
      }
    }
  }

  // Champion box (to the right of the Final)
  const championX = canvasW + COL_GAP;
  const championW = 180;
  const champion = finalMatch?.status === 'COMPLETED' && finalMatch?.winner_id
    ? (finalMatch.winner_id === finalMatch.fighter_red_id ? finalMatch.fighter_red_name : finalMatch.fighter_blue_name)
    : null;
  const finalTop = LABEL_H + (maxH - CARD_H) / 2;
  const finalMidY = finalTop + CARD_H / 2;
  const fullCanvasW = championX + championW;

  // Connector from Final card to Champion box
  elements.push(
    <g key="champ-conn">
      <line
        x1={canvasW}
        y1={finalMidY}
        x2={championX}
        y2={finalMidY}
        stroke={S}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </g>
  );

  elements.push(
    <foreignObject key="champion" x={championX} y={finalTop - 10} width={championW} height={CARD_H + 20}>
      {champion ? (
        <div className="h-full flex items-center justify-center px-3 py-2 bg-gradient-to-br from-amber-900/30 to-zinc-900 border-2 border-amber-600/50 rounded-2xl shadow-[0_0_40px_rgba(245,158,11,0.2)]">
          <div className="text-center">
            <Crown size={18} className="text-amber-400 mx-auto mb-1" />
            <div className="text-amber-400 text-[9px] font-bold uppercase tracking-[0.2em] mb-0.5">Champion</div>
            <div className="text-white text-sm font-black truncate max-w-[140px]">{champion}</div>
          </div>
        </div>
      ) : (
        <div className="h-full flex items-center justify-center px-3 py-2 bg-zinc-900/40 border border-zinc-800 rounded-2xl opacity-30">
          <div className="text-center">
            <Crown size={18} className="text-zinc-600 mx-auto mb-1" />
            <div className="text-zinc-600 text-[9px] font-bold uppercase tracking-[0.2em]">Champion</div>
          </div>
        </div>
      )}
    </foreignObject>
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        width={fullCanvasW}
        height={canvasH}
        style={{ display: 'block', minWidth: fullCanvasW }}
      >
        {elements}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MatchCard
// ─────────────────────────────────────────────────────────────────────────────

function MatchCard({
  match,
  isActive,
  onStart,
  onWalkover,
  onCorrect,
}: {
  match: BracketMatch;
  isActive: boolean;
  onStart: () => void;
  onWalkover: () => void;
  onCorrect: () => void;
}) {
  const hasRed = !!match.fighter_red_id;
  const hasBlue = !!match.fighter_blue_id;
  const hasBothFighters = hasRed && hasBlue;
  const isCompleted = match.status === 'COMPLETED';
  const isBye = match.status === 'BYE';
  const isPending = match.status === 'PENDING';

  const redIsWinner = isCompleted && match.winner_id === match.fighter_red_id;
  const blueIsWinner = isCompleted && match.winner_id === match.fighter_blue_id;

  return (
    <div
      style={{ width: '100%', height: '100%' }}
      className={`rounded-xl border overflow-hidden transition-all flex flex-col justify-between ${
        isActive
          ? 'border-emerald-500/60 shadow-[0_0_20px_rgba(16,185,129,0.2)] bg-zinc-900 cursor-pointer hover:bg-zinc-800'
          : isCompleted
          ? 'border-zinc-700/50 bg-zinc-900/60'
          : isBye
          ? 'border-zinc-800/40 bg-zinc-900/30 opacity-60'
          : hasBothFighters && (isPending || isActive)
          ? 'border-zinc-700 bg-zinc-800/80 cursor-pointer hover:border-emerald-500/50 hover:bg-zinc-800'
          : 'border-zinc-800 bg-zinc-900/80'
      }`}
      onClick={() => {
        if (hasBothFighters && (isPending || isActive)) {
          onStart();
        }
      }}
    >
      {/* Red Fighter */}
      <div
        className={`flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800/50 transition-all ${
          redIsWinner ? 'bg-red-900/20' : ''
        } ${isCompleted && !redIsWinner ? 'opacity-40' : ''}`}
      >
        <div className={`w-1.5 h-6 rounded-full flex-shrink-0 ${hasRed ? 'bg-red-500' : 'bg-zinc-700'}`} />
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-bold truncate ${hasRed ? 'text-white' : 'text-zinc-600'}`}>
            {match.fighter_red_name || (isBye && !hasRed ? 'BYE' : 'TBD')}
          </div>
        </div>
        {redIsWinner && <Crown size={14} className="text-amber-400 flex-shrink-0" />}
      </div>

      {/* Blue Fighter */}
      <div
        className={`flex items-center gap-2 px-3 py-2.5 transition-all ${
          blueIsWinner ? 'bg-blue-900/20' : ''
        } ${isCompleted && !blueIsWinner ? 'opacity-40' : ''}`}
      >
        <div className={`w-1.5 h-6 rounded-full flex-shrink-0 ${hasBlue ? 'bg-blue-500' : 'bg-zinc-700'}`} />
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-bold truncate ${hasBlue ? 'text-white' : 'text-zinc-600'}`}>
            {match.fighter_blue_name || (isBye && !hasBlue ? 'BYE' : 'TBD')}
          </div>
        </div>
        {blueIsWinner && <Crown size={14} className="text-amber-400 flex-shrink-0" />}
      </div>

      {/* Action Footer */}
      {hasBothFighters && isPending && (
        <div className="flex border-t border-zinc-800/50">
          <button
            onClick={e => { e.stopPropagation(); onStart(); }}
            className="flex-1 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Swords size={11} /> Start Fight
          </button>
          <button
            onClick={e => { e.stopPropagation(); onWalkover(); }}
            title="Opponent did not show: win by walkover"
            className="px-3 py-1.5 text-zinc-500 hover:text-white hover:bg-zinc-700/50 text-[10px] font-bold uppercase cursor-pointer border-l border-zinc-800/50"
          >
            WO
          </button>
        </div>
      )}
      {isActive && (
        <div className="w-full py-1.5 bg-emerald-600/30 text-emerald-400 text-[10px] font-bold uppercase tracking-wider text-center animate-pulse border-t border-emerald-800/30">
          ● LIVE
        </div>
      )}
      {isCompleted && (
        <div className="flex items-center border-t border-zinc-800/50 text-[10px] font-bold uppercase">
          <span className="flex-1 px-3 py-1 text-zinc-400" title={match.corrections?.length ? 'Result corrected by the chief judge' : undefined}>
            {match.method}{match.votes ? ` ${match.votes}` : ''}{match.corrections?.length ? ' · corrected' : ''}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onCorrect(); }}
            className="px-3 py-1 text-zinc-600 hover:text-amber-400 hover:bg-amber-900/10 cursor-pointer"
          >
            Correct…
          </button>
        </div>
      )}
    </div>
  );
}

/** 1st, 2nd and both 3rd places as they become known (§8). */
function Placings({ bracket, category }: { bracket: Bracket; category: WeightCategory }) {
  const name = (id: string) => category.fighters.find(f => f.id === id)?.name ?? '';
  const { first, second, third } = bracket.placings ?? { first: '', second: '', third: [] };
  if (!first && !second && third.length === 0) return null;
  return (
    <div className="flex items-center gap-3 mr-3 text-xs font-bold">
      {first && <span className="text-amber-400 flex items-center gap-1"><Crown size={13} /> {name(first)}</span>}
      {second && <span className="text-zinc-300 flex items-center gap-1"><Medal size={13} /> {name(second)}</span>}
      {third.map(id => <span key={id} className="text-orange-400 flex items-center gap-1"><Medal size={13} /> {name(id)}</span>)}
    </div>
  );
}
