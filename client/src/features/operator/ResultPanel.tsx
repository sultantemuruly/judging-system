import { CheckCircle2 } from 'lucide-react';
import type { FightView } from '../../api/protocol';
import { sendAction } from '../../api/socket';
import { cornerName, resultLabel, winnerTextColor } from '../../shared/fightText';

/** The fight result and the operator's "Confirm result" (§7). */
export default function ResultPanel({ view }: { view: FightView }) {
  const { result, clock } = view;
  const deciding = view.judges.filter(j => j.decision_needed).map(j => j.seat);

  if (!result.final) {
    if (clock.phase !== 'ENDED') return null;
    return (
      <div className="bg-zinc-900 border border-yellow-600/50 rounded-xl p-4 text-center">
        <div className="text-yellow-400 font-black uppercase tracking-wider text-sm">Waiting for judge decision</div>
        <div className="text-zinc-400 text-sm mt-1">Judge {deciding.join(', ')} must choose RED or BLUE on their phone.</div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl p-4 text-center border-2 ${result.confirmed ? 'bg-zinc-900 border-emerald-700/60' : 'bg-yellow-950/30 border-yellow-500 shadow-[0_0_30px_rgba(234,179,8,0.25)]'}`}>
      <div className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">{result.confirmed ? 'Result confirmed' : 'Result — check and confirm'}</div>
      <div className={`text-3xl font-black uppercase mt-1 ${winnerTextColor(result.winner)}`}>{cornerName(view, result.winner)}</div>
      <div className="text-zinc-300 font-bold text-sm mt-1">{resultLabel(result)}</div>
      {!result.confirmed ? (
        <button
          onClick={() => sendAction('CONFIRM_RESULT')}
          className="mt-3 w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-black uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2"
        >
          <CheckCircle2 size={18} /> Confirm result
        </button>
      ) : (
        <div className="mt-2 text-emerald-400 text-xs font-bold">Shown to viewers{view.bracket ? ' · bracket updated' : ''}</div>
      )}
    </div>
  );
}
