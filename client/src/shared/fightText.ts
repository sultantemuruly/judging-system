import type { Corner, CornerView, FightResult, FightView } from '../api/protocol';

export function cornerName(view: FightView, corner: Corner | ''): string {
  if (corner === 'Red') return view.red_name || 'Red Corner';
  if (corner === 'Blue') return view.blue_name || 'Blue Corner';
  return '';
}

/** How the fight was won, for result banners. */
export function resultLabel(r: FightResult): string {
  switch (r.method) {
    case 'PTS': return `WIN BY POINTS ${r.votes ?? ''}`.trim();
    case 'KO': return 'WIN BY KNOCKOUT (KO)';
    case 'RSC': return 'REFEREE STOPS CONTEST (RSC)';
    case 'DQ': return r.winner === 'Red' ? 'BLUE DISQUALIFIED' : 'RED DISQUALIFIED';
    case 'AB': return 'OPPONENT ABANDONED (AB)';
    case 'WO': return 'WALKOVER (WO)';
  }
  return '';
}

/** "Red: 2 (−3 pts)" for the warnings summary line. */
export function penaltySummary(name: string, c: CornerView): string {
  if (c.warnings === 0 && c.penalty === 0) return '';
  let s = `${name}: ${c.warnings}`;
  if (c.penalty > 0) s += ` (−${c.penalty} pts)`;
  if (c.warnings >= 4) s += ' → DQ';
  return s;
}

export function formatMs(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function resultBannerStyle(winner: Corner | ''): string {
  if (winner === 'Red') return 'bg-gradient-to-br from-red-950/80 to-zinc-900 border-red-800/50 shadow-[0_0_80px_rgba(239,68,68,0.2)]';
  if (winner === 'Blue') return 'bg-gradient-to-br from-blue-950/80 to-zinc-900 border-blue-800/50 shadow-[0_0_80px_rgba(59,130,246,0.2)]';
  return 'bg-gradient-to-br from-zinc-800 to-zinc-900 border-zinc-600/50';
}

export function winnerTextColor(winner: Corner | ''): string {
  return winner === 'Red' ? 'text-red-500' : winner === 'Blue' ? 'text-blue-500' : 'text-zinc-300';
}
