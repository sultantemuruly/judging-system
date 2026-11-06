import { useState } from 'react';
import { Settings } from 'lucide-react';
import type { ClockView } from '../../api/protocol';
import { sendAction } from '../../api/socket';
import { formatMs } from '../../shared/fightText';

const select = 'mt-2 w-full bg-zinc-950 border border-zinc-800 text-white rounded-lg px-3 py-2.5 outline-none focus:border-emerald-500';

/** New standalone fight with its own format; bracket fights use their category's format. */
export default function NewFightDialog({ clock, onClose }: { clock: ClockView; onClose: () => void }) {
  const [rounds, setRounds] = useState(clock.rounds);
  const [roundSeconds, setRoundSeconds] = useState(clock.round_ms / 1000);
  const [restSeconds, setRestSeconds] = useState(clock.rest_ms / 1000);

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-black text-white mb-2 flex items-center gap-2">
          <Settings size={20} className="text-zinc-400" /> New Fight
        </h2>
        <p className="text-zinc-400 text-sm mb-6">Resets scores, warnings and knockdowns. An unconfirmed bracket match goes back to the queue. Bracket fights are started from the bracket and use their category's format.</p>
        <div className="grid grid-cols-3 gap-3 mb-8">
          <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider">Rounds
            <select value={rounds} onChange={e => setRounds(Number(e.target.value))} className={select}>
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider">Round
            <select value={roundSeconds} onChange={e => setRoundSeconds(Number(e.target.value))} className={select}>
              {[60, 90, 120, 150, 180].map(n => <option key={n} value={n}>{formatMs(n * 1000)}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider">Rest
            <select value={restSeconds} onChange={e => setRestSeconds(Number(e.target.value))} className={select}>
              {[30, 45, 60, 90, 120].map(n => <option key={n} value={n}>{formatMs(n * 1000)}</option>)}
            </select>
          </label>
        </div>
        <div className="flex gap-3 justify-end">
          <button className="px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl font-bold hover:bg-zinc-700 cursor-pointer" onClick={onClose}>Cancel</button>
          <button
            className="px-5 py-2.5 bg-red-600 text-white rounded-xl font-bold hover:bg-red-500 cursor-pointer"
            onClick={() => {
              sendAction('NEW_FIGHT', { rounds, round_seconds: roundSeconds, rest_seconds: restSeconds });
              onClose();
            }}
          >
            Reset & Start New Fight
          </button>
        </div>
      </div>
    </div>
  );
}
