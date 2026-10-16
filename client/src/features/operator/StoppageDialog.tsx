import { useState } from 'react';
import type { Corner, FightView, Method } from '../../api/protocol';
import { sendAction } from '../../api/socket';
import { cornerName } from '../../shared/fightText';

const methods: { method: Method; label: string }[] = [
  { method: 'KO', label: 'KO — knockout' },
  { method: 'RSC', label: 'RSC — referee stops contest' },
  { method: 'DQ', label: 'DQ — opponent disqualified' },
  { method: 'AB', label: 'AB — opponent abandons' },
];

interface Props {
  view: FightView;
  /** Preselected by the knockdown-limit prompt. */
  initial?: { winner: Corner; method: Method };
  onClose: () => void;
}

/** Ends the fight early: the operator picks the winner and how (§5). A DQ asks twice. */
export default function StoppageDialog({ view, initial, onClose }: Props) {
  const [winner, setWinner] = useState<Corner | ''>(initial?.winner ?? '');
  const [method, setMethod] = useState<Method | ''>(initial?.method ?? '');
  const [confirmDQ, setConfirmDQ] = useState(false);
  const ready = winner !== '' && method !== '';

  const submit = () => {
    if (!ready) return;
    if (method === 'DQ' && !confirmDQ) {
      setConfirmDQ(true);
      return;
    }
    sendAction('STOPPAGE', { corner: winner, method });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-7 max-w-lg w-full shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-black text-white mb-5">Stop the fight</h2>
        <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Winner</div>
        <div className="grid grid-cols-2 gap-3 mb-5">
          {(['Red', 'Blue'] as Corner[]).map(c => (
            <button
              key={c}
              onClick={() => { setWinner(c); setConfirmDQ(false); }}
              className={`py-3 rounded-xl font-black uppercase border-2 cursor-pointer ${winner === c ? (c === 'Red' ? 'bg-red-600 border-red-400 text-white' : 'bg-blue-600 border-blue-400 text-white') : 'bg-zinc-800 border-zinc-700 text-zinc-300'}`}
            >
              {cornerName(view, c)}
            </button>
          ))}
        </div>
        <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Method</div>
        <div className="grid grid-cols-2 gap-2 mb-6">
          {methods.map(m => (
            <button
              key={m.method}
              onClick={() => { setMethod(m.method); setConfirmDQ(false); }}
              className={`py-2.5 px-3 rounded-lg font-bold text-sm text-left border cursor-pointer ${method === m.method ? 'bg-zinc-100 text-black border-white' : 'bg-zinc-800 text-zinc-300 border-zinc-700'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {confirmDQ && (
          <div className="mb-4 rounded-lg bg-red-950/60 border border-red-700 text-red-200 p-3 text-sm font-bold">
            Disqualify {cornerName(view, winner === 'Red' ? 'Blue' : 'Red')}? Press again to confirm.
          </div>
        )}
        <div className="flex gap-3 justify-end">
          <button className="px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl font-bold hover:bg-zinc-700 cursor-pointer" onClick={onClose}>Cancel</button>
          <button
            disabled={!ready}
            onClick={submit}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-30 text-white rounded-xl font-bold cursor-pointer"
          >
            {confirmDQ ? 'Confirm disqualification' : 'Stop fight'}
          </button>
        </div>
      </div>
    </div>
  );
}
