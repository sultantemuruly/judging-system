import { useState } from 'react';
import type { WeightCategory } from '../../api/protocol';
import { sendAction } from '../../api/socket';

const nextPowerOf2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(n, 1)));

/** Draw the bracket automatically or place fighters by hand; regenerating says what it throws away. */
export default function GenerateBracketDialog({ category, regenerate, onClose }: { category: WeightCategory; regenerate: boolean; onClose: () => void }) {
  const fighters = category.fighters ?? [];
  const size = nextPowerOf2(fighters.length);
  const [manual, setManual] = useState(false);
  const [slots, setSlots] = useState<string[]>(() => Array(size).fill(''));
  const placed = slots.filter(Boolean).length;
  const ready = !manual || fighters.every(f => slots.includes(f.id));

  const generate = () => {
    sendAction('GENERATE_BRACKET', manual ? { category_id: category.id, manual_seeding: slots } : { category_id: category.id });
    onClose();
  };
  const mode = (on: boolean) => `flex-1 py-2.5 rounded-lg text-sm font-bold cursor-pointer ${manual === on ? 'bg-zinc-100 text-black' : 'text-zinc-400 hover:text-white'}`;

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-6 pb-4">
          <h2 className="text-xl font-black text-white">{regenerate ? 'Regenerate' : 'Generate'} bracket: {category.name}</h2>
          {regenerate && (
            <div className="mt-3 rounded-lg bg-red-950/50 border border-red-800 text-red-200 p-3 text-sm font-bold">
              The current draw is thrown away and a new one is made.
            </div>
          )}
          <div className="mt-4 flex bg-zinc-950 rounded-xl p-1 border border-zinc-800">
            <button onClick={() => setManual(false)} className={mode(false)}>Automatic</button>
            <button onClick={() => setManual(true)} className={mode(true)}>Place by hand</button>
          </div>
          <p className="text-sm text-zinc-400 mt-3">
            {manual
              ? `Put each fighter in a slot (${placed} of ${fighters.length} placed). Empty slots are byes.`
              : 'Fighters are drawn into the bracket at random.'}
          </p>
        </div>

        {manual && (
          <div className="px-6 overflow-y-auto min-h-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {slots.map((id, i) => (
              <label key={i} className="flex items-center gap-3 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2">
                <span className="w-6 text-xs font-black text-zinc-500">{i + 1}</span>
                <select
                  value={id}
                  onChange={e => setSlots(s => s.map((v, j) => (j === i ? e.target.value : v)))}
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg text-white text-sm px-2 py-1.5"
                >
                  <option value="">Bye</option>
                  {fighters.map(f => (
                    <option key={f.id} value={f.id} disabled={slots.includes(f.id) && f.id !== id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}

        <div className="p-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl font-bold hover:bg-zinc-700 cursor-pointer">Cancel</button>
          <button disabled={!ready} onClick={generate} className={`px-5 py-2.5 text-white rounded-xl font-bold disabled:opacity-30 cursor-pointer ${regenerate ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}>
            {regenerate ? 'Replace bracket' : 'Generate bracket'}
          </button>
        </div>
      </div>
    </div>
  );
}
