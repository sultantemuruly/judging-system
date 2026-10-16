import type { WeightCategory } from '../../api/protocol';

const sexes: Record<string, string> = { male: 'Men', female: 'Women' };
const disciplines: Record<string, string> = { 'k-1': 'K-1', 'low-kick': 'Low-kick', 'full-contact': 'Full contact' };

/** "Men · Seniors · K-1 · 6 fighters" */
export function categoryLabel(c: WeightCategory): string {
  const n = c.fighters?.length ?? 0;
  return [sexes[c.sex] ?? c.sex, c.gender, disciplines[c.discipline] ?? c.discipline, `${n} fighter${n === 1 ? '' : 's'}`]
    .filter(Boolean)
    .join(' · ');
}

/** "3 × 2:00, rest 1:00 · KD limit 3 / 4" */
export function formatLabel(c: WeightCategory): string {
  if (!c.format) return '';
  const t = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const f = c.format;
  return `${f.rounds} × ${t(f.round_seconds)}, rest ${t(f.rest_seconds)} · KD limit ${f.kd_limit_round} / ${f.kd_limit_fight}`;
}
