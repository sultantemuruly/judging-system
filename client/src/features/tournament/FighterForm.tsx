import { useState } from 'react';
import type { TournamentFighter } from '../../api/protocol';
import { sendAction } from '../../api/socket';

type LastYear = '' | 'champion' | 'second';

const input = 'px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-400';

/** One row to add a fighter, or to edit the one picked from the list. */
export default function FighterForm({ categoryId, fighter, canAdd, onDone }: {
  categoryId: string;
  fighter: TournamentFighter | null;
  /** False once the bracket is locked: existing fighters can still be edited. */
  canAdd: boolean;
  onDone: () => void;
}) {
  const [name, setName] = useState(fighter?.name ?? '');
  const [city, setCity] = useState(fighter?.city ?? '');
  const [club, setClub] = useState(fighter?.club ?? '');
  const [lastYear, setLastYear] = useState<LastYear>(fighter?.is_previous_champion ? 'champion' : fighter?.is_previous_second ? 'second' : '');
  const editing = !!fighter;
  const disabled = !name.trim() || (!editing && !canAdd);

  const save = () => {
    if (disabled) return;
    const f = { name: name.trim(), city: city.trim(), club: club.trim(), is_previous_champion: lastYear === 'champion', is_previous_second: lastYear === 'second' };
    if (fighter) sendAction('EDIT_FIGHTER', { category_id: categoryId, fighter_id: fighter.id, fighter: f });
    else sendAction('ADD_FIGHTER', { category_id: categoryId, fighter: f });
    setName(''); setCity(''); setClub(''); setLastYear('');
    onDone();
  };

  return (
    <div className="px-5 py-4 border-b border-zinc-800 bg-zinc-900/30">
      <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">
        {editing ? `Edit ${fighter.name}` : canAdd ? 'Add a fighter' : 'Bracket in progress: fighters can be edited, not added'}
      </div>
      <form className="flex gap-2 items-center flex-wrap" onSubmit={e => { e.preventDefault(); save(); }}>
        <input className={`${input} flex-[2] min-w-44 w-0`} placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
        <input className={`${input} flex-1 min-w-32 w-0`} placeholder="City" value={city} onChange={e => setCity(e.target.value)} />
        <input className={`${input} flex-1 min-w-32 w-0`} placeholder="Club" value={club} onChange={e => setClub(e.target.value)} />
        <select className={input} value={lastYear} onChange={e => setLastYear(e.target.value as LastYear)} title="Used to seed the bracket">
          <option value="">Last year: —</option>
          <option value="champion">Last year: champion</option>
          <option value="second">Last year: runner-up</option>
        </select>
        <button type="submit" disabled={disabled} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 text-white text-sm font-bold rounded-lg cursor-pointer">
          {editing ? 'Save' : 'Add'}
        </button>
        {editing && (
          <button type="button" onClick={onDone} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-bold rounded-lg cursor-pointer">Cancel</button>
        )}
      </form>
    </div>
  );
}
