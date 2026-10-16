import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { TournamentFighter, TournamentState, WeightCategory } from '../../api/protocol';
import { sendAction } from '../../api/socket';
import ConfirmDialog from '../../shared/ConfirmDialog';
import NavBar from '../../shared/NavBar';
import CategoryDialog from './CategoryDialog';
import FighterForm from './FighterForm';
import GenerateBracketDialog from './GenerateBracketDialog';
import { categoryLabel, formatLabel } from './categoryText';

type Dialog =
  | { kind: 'category'; category?: WeightCategory }
  | { kind: 'generate' }
  | { kind: 'deleteCategory' }
  | { kind: 'deleteFighter'; fighter: TournamentFighter };

/** Categories page: the tournament's name and date, its weight categories, and each category's fighters and bracket. */
export default function BracketSetup({ tournament }: { tournament: TournamentState }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [editing, setEditing] = useState<TournamentFighter | null>(null);

  const categories = tournament.categories;
  const selected = categories.find(c => c.id === selectedId) ?? categories[0];
  const bracket = selected ? tournament.brackets?.[selected.id] : undefined;
  // After the first decided fight, or while a fight is on the ring, the bracket is fixed (§8).
  const locked = !!bracket?.locked;
  const fighters = selected?.fighters ?? [];
  const close = () => setDialog(null);
  // Adding or removing fighters doesn't change a drawn bracket; say so until it is drawn again.
  const drawn = new Set(bracket?.matches.filter(m => m.round === 1).flatMap(m => [m.fighter_red_id, m.fighter_blue_id]).filter(Boolean));
  const stale = !!bracket?.generated && !locked && (drawn.size !== fighters.length || fighters.some(f => !drawn.has(f.id)));

  return (
    <div className="h-screen bg-zinc-950 flex flex-col">
      <NavBar />
      <div className="flex-1 flex min-h-0">
        {/* Left: tournament and its categories */}
        <aside className="w-80 border-r border-zinc-800 flex flex-col bg-zinc-900/40">
          <TournamentInfo key={`${tournament.name}|${tournament.date}`} name={tournament.name} date={tournament.date} />
          <div className="px-4 py-3 flex items-center justify-between border-y border-zinc-800">
            <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Categories</span>
            <button onClick={() => setDialog({ kind: 'category' })} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-lg flex items-center gap-1 cursor-pointer">
              <Plus size={14} /> New
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {categories.length === 0 && <div className="text-center text-zinc-500 text-sm py-12 px-4">No categories yet. Press “New” to add one.</div>}
            {categories.map(c => {
              const b = tournament.brackets?.[c.id];
              return (
                <button
                  key={c.id}
                  onClick={() => { setSelectedId(c.id); setEditing(null); }}
                  className={`w-full text-left px-4 py-3 border-b border-zinc-800/60 border-l-2 cursor-pointer ${c.id === selected?.id ? 'bg-zinc-800/80 border-l-emerald-500' : 'border-l-transparent hover:bg-zinc-800/40'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white font-bold">{c.name}</span>
                    <span className="text-[11px] font-bold text-zinc-500">{b?.locked ? 'In progress' : b?.generated ? 'Bracket ready' : ''}</span>
                  </div>
                  <div className="text-zinc-500 text-xs mt-0.5">{categoryLabel(c)}</div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right: the selected category */}
        <main className="flex-1 flex flex-col min-w-0">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-zinc-500">Add a category to start.</div>
          ) : (
            <>
              <div className="p-5 border-b border-zinc-800 flex flex-wrap items-start gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-black text-white">{selected.name}</h1>
                    <button onClick={() => setDialog({ kind: 'category', category: selected })} title="Edit category" className="p-1.5 text-zinc-400 hover:text-white cursor-pointer"><Pencil size={15} /></button>
                    <button onClick={() => setDialog({ kind: 'deleteCategory' })} title="Delete category" className="p-1.5 text-zinc-400 hover:text-red-400 cursor-pointer"><Trash2 size={15} /></button>
                  </div>
                  <div className="text-zinc-400 text-sm">{categoryLabel(selected)}</div>
                  <div className="text-zinc-500 text-xs mt-0.5">{formatLabel(selected)}</div>
                </div>
                <div className="ml-auto flex items-center gap-3">
                  {stale && <span className="text-sm font-bold text-yellow-400">Fighters changed since the draw: regenerate</span>}
                  {bracket?.generated && (
                    <Link to={`/tournament/bracket/${selected.id}`} className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-bold rounded-xl">
                      Open bracket
                    </Link>
                  )}
                  {locked ? (
                    <span className="text-sm font-bold text-zinc-500" title="A fight is on the ring or decided: no new draw, no adding or removing fighters">Bracket in progress</span>
                  ) : (
                    <button
                      onClick={() => setDialog({ kind: 'generate' })}
                      disabled={fighters.length < 2}
                      title={fighters.length < 2 ? 'Add at least 2 fighters' : undefined}
                      className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-30 text-white text-sm font-bold rounded-xl cursor-pointer"
                    >
                      {bracket?.generated ? 'Regenerate bracket…' : 'Generate bracket…'}
                    </button>
                  )}
                </div>
              </div>

              <FighterForm
                key={`${selected.id}:${editing?.id ?? 'new'}`}
                categoryId={selected.id}
                fighter={editing}
                canAdd={!locked}
                onDone={() => setEditing(null)}
              />

              <div className="flex-1 overflow-y-auto">
                {fighters.length === 0 && <div className="text-center text-zinc-500 text-sm py-16">No fighters yet. Add them with the form above.</div>}
                {fighters.map((f, i) => (
                  <div key={f.id} className={`flex items-center gap-4 px-5 py-3 border-b border-zinc-800/50 ${editing?.id === f.id ? 'bg-zinc-800/50' : ''}`}>
                    <span className="w-6 text-zinc-500 text-sm font-bold">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-bold text-sm">
                        {f.name}
                        {f.is_previous_champion && <span className="ml-2 text-[11px] text-amber-400">last year’s champion</span>}
                        {f.is_previous_second && <span className="ml-2 text-[11px] text-zinc-400">last year’s runner-up</span>}
                      </div>
                      <div className="text-zinc-500 text-xs">{[f.city, f.club].filter(Boolean).join(' · ')}</div>
                    </div>
                    <button onClick={() => setEditing(f)} title="Edit fighter" className="p-1.5 text-zinc-400 hover:text-white cursor-pointer"><Pencil size={15} /></button>
                    {!locked && (
                      <button onClick={() => setDialog({ kind: 'deleteFighter', fighter: f })} title="Remove fighter" className="p-1.5 text-zinc-400 hover:text-red-400 cursor-pointer"><Trash2 size={15} /></button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </main>
      </div>

      {dialog?.kind === 'category' && <CategoryDialog category={dialog.category} onClose={close} />}
      {dialog?.kind === 'generate' && selected && <GenerateBracketDialog category={selected} regenerate={!!bracket?.generated} onClose={close} />}
      {dialog?.kind === 'deleteCategory' && selected && (
        <ConfirmDialog
          title={`Delete ${selected.name}?`}
          confirmLabel="Delete category"
          danger
          onCancel={close}
          onConfirm={() => { sendAction('DELETE_CATEGORY', { category_id: selected.id }); setSelectedId(null); close(); }}
        >
          {fighters.length === 1 ? 'Its fighter' : `Its ${fighters.length} fighters`} and its bracket are deleted too.
        </ConfirmDialog>
      )}
      {dialog?.kind === 'deleteFighter' && selected && (
        <ConfirmDialog
          title={`Remove ${dialog.fighter.name}?`}
          confirmLabel="Remove fighter"
          danger
          onCancel={close}
          onConfirm={() => { sendAction('DELETE_FIGHTER', { category_id: selected.id, fighter_id: dialog.fighter.id }); close(); }}
        >
          {bracket?.generated ? 'The bracket then has to be regenerated.' : `${dialog.fighter.name} is removed from ${selected.name}.`}
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Tournament name and date, printed on every bracket PDF (§8). */
function TournamentInfo({ name, date }: { name: string; date: string }) {
  const [n, setN] = useState(name);
  const [d, setD] = useState(date);
  const dirty = n !== name || d !== date;
  return (
    <div className="p-4 flex flex-col gap-2">
      <input value={n} onChange={e => setN(e.target.value)} placeholder="Tournament name"
        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white font-bold placeholder-zinc-500" />
      <div className="flex gap-2">
        <input type="date" value={d} onChange={e => setD(e.target.value)}
          className="flex-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm" />
        {dirty && (
          <button onClick={() => sendAction('SET_TOURNAMENT_INFO', { name: n, date: d })}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-lg cursor-pointer">
            Save
          </button>
        )}
      </div>
    </div>
  );
}
