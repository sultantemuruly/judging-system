import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { type TournamentState, type BracketMatch, type Bracket, type WeightCategory, sendAction } from './socket';
import { ArrowLeft, Crown, RotateCcw, Swords } from 'lucide-react';

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
          <button
            onClick={() => {
              if (window.confirm('Are you sure you want to regenerate this bracket? All current matches and results will be lost.')) {
                sendAction('GENERATE_BRACKET', { category_id: categoryId });
              }
            }}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-bold rounded-xl transition-all flex items-center gap-2 border border-zinc-700 cursor-pointer"
          >
            <RotateCcw size={14} /> Regenerate
          </button>
        </div>
      </div>

      {/* Bracket */}
      <div className="p-6 overflow-x-auto">
        <SymmetricBracketTree
          bracket={bracket}
          category={category}
          activeBracketMatchId={tournament.active_match_bracket_match_id}
          onStartMatch={(matchId) => {
            sendAction('START_BRACKET_MATCH', { category_id: categoryId, match_id: matchId });
            navigate('/');
          }}
          onSetWinner={(matchId, winnerId) => {
            sendAction('SET_MATCH_WINNER', { category_id: categoryId, match_id: matchId, winner_id: winnerId });
          }}
        />
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
  onSetWinner: (matchId: string, winnerId: string) => void;
}

export function SymmetricBracketTree({
  bracket,
  activeBracketMatchId,
  onStartMatch,
  onSetWinner,
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
  const elements: React.ReactElement[] = [];

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
            onSetWinner={(wId) => onSetWinner(match.id, wId)}
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
  onSetWinner,
}: {
  match: BracketMatch;
  isActive: boolean;
  onStart: () => void;
  onSetWinner: (winnerId: string) => void;
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
        <button
          onClick={onStart}
          className="w-full py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer border-t border-zinc-800/50"
        >
          <Swords size={11} /> Start Fight
        </button>
      )}
      {isActive && (
        <div className="w-full py-1.5 bg-emerald-600/30 text-emerald-400 text-[10px] font-bold uppercase tracking-wider text-center animate-pulse border-t border-emerald-800/30">
          ● LIVE
        </div>
      )}
      {isCompleted && hasBothFighters && (
        <div className="flex border-t border-zinc-800/50">
          <button
            onClick={() => onSetWinner(match.fighter_red_id)}
            className={`flex-1 py-1 text-[9px] font-bold uppercase transition-all cursor-pointer ${
              redIsWinner ? 'text-red-400 bg-red-900/10' : 'text-zinc-600 hover:text-red-400 hover:bg-red-900/10'
            }`}
          >
            Red Wins
          </button>
          <div className="w-px bg-zinc-800/50" />
          <button
            onClick={() => onSetWinner(match.fighter_blue_id)}
            className={`flex-1 py-1 text-[9px] font-bold uppercase transition-all cursor-pointer ${
              blueIsWinner ? 'text-blue-400 bg-blue-900/10' : 'text-zinc-600 hover:text-blue-400 hover:bg-blue-900/10'
            }`}
          >
            Blue Wins
          </button>
        </div>
      )}
    </div>
  );
}
