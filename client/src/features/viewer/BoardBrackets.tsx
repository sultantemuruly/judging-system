import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pause, Play } from 'lucide-react';
import type { TournamentState } from '../../api/protocol';
import BracketTree from '../tournament/BracketTree';
import Placings from '../tournament/Placings';
import { categoryLabel } from '../tournament/categoryText';
import BoardHeader from './BoardHeader';
import FitToScreen from './FitToScreen';

const ROTATE_MS = 20_000;

/**
 * /board/brackets: the brackets for a TV in the hall, read-only and open
 * without a login. One category at a time, scaled to the screen; «Auto» steps
 * through the categories. The URL keeps the choice (?cat=<id>&auto=1), so a TV
 * can be pointed straight at it. Brackets only change once the operator
 * confirms a result (§7), so nothing here is ahead of the announcement.
 */
export default function BoardBrackets({ tournament }: { tournament: TournamentState }) {
  const [params, setParams] = useSearchParams();
  const generated = tournament.categories.filter(c => tournament.brackets?.[c.id]?.generated);
  const auto = params.get('auto') === '1';
  const current = generated.find(c => c.id === params.get('cat')) ?? generated[0];

  const select = (id: string, keepAuto = auto) => setParams(keepAuto ? { cat: id, auto: '1' } : { cat: id }, { replace: true });

  useEffect(() => {
    if (!auto || generated.length < 2 || !current) return;
    const t = window.setTimeout(() => {
      const i = generated.findIndex(c => c.id === current.id);
      select(generated[(i + 1) % generated.length].id, true);
    }, ROTATE_MS);
    return () => clearTimeout(t);
  });

  const tab = (active: boolean, onRing: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap cursor-pointer ${active ? 'bg-zinc-100 text-black' : onRing ? 'bg-emerald-900/50 text-emerald-300' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`;

  return (
    <div className="h-screen w-full flex flex-col bg-zinc-950 overflow-hidden">
      <BoardHeader />
      {!current ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-lg font-bold">No brackets yet</div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-900 flex-shrink-0">
            <div className="flex gap-2 overflow-x-auto flex-1 min-w-0">
              {generated.map(c => (
                <button key={c.id} onClick={() => select(c.id)} className={tab(c.id === current.id, c.id === tournament.active_match_category_id)}>
                  {c.name}
                </button>
              ))}
            </div>
            <button
              onClick={() => setParams(auto ? { cat: current.id } : { cat: current.id, auto: '1' }, { replace: true })}
              title="Step through the categories by themselves"
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-1.5 cursor-pointer ${auto ? 'bg-emerald-600/30 text-emerald-300' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
            >
              {auto ? <Pause size={14} /> : <Play size={14} />} Auto
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 sm:px-6 pt-4 flex-shrink-0">
            <h2 className="text-3xl font-black text-white">{current.name}</h2>
            <div className="text-sm text-zinc-500 font-medium">{categoryLabel(current)}</div>
            <Placings bracket={tournament.brackets[current.id]} category={current} />
          </div>
          <div className="flex-1 min-h-0 min-w-0 flex p-3 sm:p-6">
            <FitToScreen>
              <BracketTree bracket={tournament.brackets[current.id]} activeBracketMatchId={tournament.active_match_bracket_match_id} />
            </FitToScreen>
          </div>
        </>
      )}
    </div>
  );
}
