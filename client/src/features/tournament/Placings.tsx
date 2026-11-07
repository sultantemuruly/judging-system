import { Crown, Medal } from 'lucide-react';
import type { Bracket, WeightCategory } from '../../api/protocol';

/** 1st, 2nd and both 3rd places as they become known (§8). */
export default function Placings({ bracket, category }: { bracket: Bracket; category: WeightCategory }) {
  const name = (id: string) => category.fighters.find(f => f.id === id)?.name ?? '';
  const { first, second, third } = bracket.placings ?? { first: '', second: '', third: [] };
  if (!first && !second && third.length === 0) return null;
  return (
    <div className="flex items-center gap-3 text-sm font-bold">
      {first && <span className="text-amber-400 flex items-center gap-1"><Crown size={14} /> {name(first)}</span>}
      {second && <span className="text-zinc-300 flex items-center gap-1"><Medal size={14} /> {name(second)}</span>}
      {third.map(id => <span key={id} className="text-orange-400 flex items-center gap-1"><Medal size={14} /> {name(id)}</span>)}
    </div>
  );
}
