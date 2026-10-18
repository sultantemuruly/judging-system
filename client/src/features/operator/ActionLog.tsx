import { Undo2 } from 'lucide-react';
import type { ActionView, FightView } from '../../api/protocol';
import { sendAction } from '../../api/socket';

function describe(a: ActionView): string {
  switch (a.type) {
    case 'OfficialWarning':
      if (a.undone) return 'Warning';
      return `Warning #${a.warning_number}${a.disqualifies ? ' → DQ' : a.deduction ? ` (−${a.deduction})` : ''}`;
    case 'MinusPoint': return `Minus point (−${a.deduction})`;
    case 'Knockdown': return `Knockdown (−${a.deduction})`;
    case 'Stoppage': return `Stoppage: wins ${a.method}`;
  }
}

/** Referee actions of this fight; any of them can be undone until the result is confirmed (§4). */
export default function ActionLog({ view }: { view: FightView }) {
  const actions = [...view.actions].reverse();
  const locked = view.result.confirmed;
  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 flex flex-col min-h-0 flex-1">
      <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Referee actions</div>
      {actions.length === 0 && <div className="text-zinc-600 text-sm">None yet</div>}
      <div className="flex flex-col gap-1.5 overflow-y-auto min-h-0">
        {actions.map(a => (
          <div key={a.id} className={`flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 bg-zinc-950/60 ${a.undone ? 'opacity-40 line-through' : ''}`}>
            <span className="text-zinc-500 text-xs font-bold w-6">R{a.round}</span>
            <span className={`w-2 h-2 rounded-full ${a.corner === 'Red' ? 'bg-red-500' : 'bg-blue-500'}`} />
            <span className="flex-1 text-zinc-200 font-bold">{describe(a)}</span>
            {!a.undone && !locked && (
              <button
                onClick={() => sendAction('UNDO_REFEREE_ACTION', { target_id: a.id })}
                className="text-zinc-400 hover:text-white p-1 rounded cursor-pointer"
                title="Undo"
              >
                <Undo2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
