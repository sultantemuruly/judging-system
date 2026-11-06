import { Link, NavLink, useParams } from 'react-router-dom';
import { Crown, Medal, Printer } from 'lucide-react';
import type { Bracket, TournamentState, WeightCategory } from '../../api/protocol';
import NavBar from '../../shared/NavBar';
import BracketBoard from './BracketBoard';
import { categoryLabel } from './categoryText';

/** Every generated bracket, or one category's (/tournament/bracket/:categoryId), picked from a row of tabs. */
export default function BracketsPage({ tournament }: { tournament: TournamentState }) {
  const { categoryId } = useParams<{ categoryId: string }>();
  const generated = tournament.categories.filter(c => tournament.brackets?.[c.id]?.generated);
  const shown = categoryId ? generated.filter(c => c.id === categoryId) : generated;
  const tab = (active: boolean) => `px-3 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap ${active ? 'bg-zinc-100 text-black' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`;

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <NavBar />
      {generated.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-6">
          <div className="text-zinc-300 text-lg font-bold">No brackets yet</div>
          <div className="text-zinc-500 text-sm">Add fighters to a category and press “Generate bracket”.</div>
          <Link to="/tournament/setup" className="mt-3 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-bold rounded-lg">Go to categories</Link>
        </div>
      ) : (
        <>
          <div className="flex gap-2 px-4 py-3 border-b border-zinc-900 overflow-x-auto">
            <NavLink to="/tournament/brackets" end className={({ isActive }) => tab(isActive)}>All</NavLink>
            {generated.map(c => (
              <NavLink key={c.id} to={`/tournament/bracket/${c.id}`} className={({ isActive }) => tab(isActive)}>{c.name}</NavLink>
            ))}
          </div>
          {shown.length === 0 && <div className="p-8 text-zinc-500 text-center">This category has no bracket yet.</div>}
          {shown.map(c => (
            <section key={c.id} className="px-4 py-6 border-b border-zinc-900">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
                <div>
                  <h2 className="text-xl font-black text-white">{c.name}</h2>
                  <div className="text-xs text-zinc-500 font-medium">{categoryLabel(c)}</div>
                </div>
                <Placings bracket={tournament.brackets[c.id]} category={c} />
                <Link to={`/tournament/print/${c.id}`} className="ml-auto px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-bold rounded-lg flex items-center gap-2">
                  <Printer size={14} /> Print / PDF
                </Link>
              </div>
              <BracketBoard tournament={tournament} category={c} bracket={tournament.brackets[c.id]} />
            </section>
          ))}
        </>
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
    <div className="flex items-center gap-3 text-sm font-bold">
      {first && <span className="text-amber-400 flex items-center gap-1"><Crown size={14} /> {name(first)}</span>}
      {second && <span className="text-zinc-300 flex items-center gap-1"><Medal size={14} /> {name(second)}</span>}
      {third.map(id => <span key={id} className="text-orange-400 flex items-center gap-1"><Medal size={14} /> {name(id)}</span>)}
    </div>
  );
}
