import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { FightView, JudgeView } from '../../api/protocol';
import { sendAction } from '../../api/socket';
import ConfirmDialog from '../../shared/ConfirmDialog';
import { cornerName, resultLabel, winnerTextColor } from '../../shared/fightText';

/** Why a judge holds up the confirmation, or '' when they don't. */
function judgeHold(j: JudgeView): string {
  if (!j.connected) return `Judge ${j.seat} is offline`;
  if (j.pending > 0) return `Judge ${j.seat}: ${j.pending} tap${j.pending === 1 ? '' : 's'} not sent yet`;
  return '';
}

/** The fight result and the operator's "Confirm result" (§7). */
export default function ResultPanel({ view }: { view: FightView }) {
  const { result, clock } = view;
  const deciding = view.judges.filter(j => j.decision_needed).map(j => j.seat);
  const holds = view.judges.map(judgeHold).filter(Boolean);
  const [forcing, setForcing] = useState(false);

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
      {!result.confirmed && view.judges_synced && (
        <button
          onClick={() => sendAction('CONFIRM_RESULT')}
          className="mt-3 w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-black uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2"
        >
          <CheckCircle2 size={18} /> Confirm result
        </button>
      )}
      {!result.confirmed && !view.judges_synced && (
        <div className="mt-3 text-left">
          <div className="text-amber-300 text-xs font-bold">Waiting for judges' taps before confirming (§7):</div>
          <ul className="text-zinc-300 text-xs mt-1 list-disc pl-5">
            {holds.map(h => <li key={h}>{h}</li>)}
          </ul>
          <button
            onClick={() => setForcing(true)}
            className="mt-2 w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg font-bold text-sm cursor-pointer"
          >
            Confirm anyway…
          </button>
        </div>
      )}
      {forcing && (
        <ConfirmDialog
          title="Confirm without these judges' taps?"
          confirmLabel="Confirm anyway"
          danger
          onCancel={() => setForcing(false)}
          onConfirm={() => { setForcing(false); sendAction('CONFIRM_RESULT', { force: true }); }}
        >
          <ul className="list-disc pl-5">{holds.map(h => <li key={h}>{h}</li>)}</ul>
          <p className="mt-2">Only do this if the phone is broken or gone. Taps it sends later will not count.</p>
        </ConfirmDialog>
      )}
      {result.confirmed && view.result_not_recorded && (
        <div className="mt-3 rounded-lg bg-red-950/60 border border-red-700 p-3">
          <div className="text-red-200 text-sm font-bold">Not saved in the bracket yet.</div>
          <button
            onClick={() => sendAction('CONFIRM_RESULT')}
            className="mt-2 w-full py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold text-sm cursor-pointer"
          >
            Retry saving to the bracket
          </button>
        </div>
      )}
      {result.confirmed && !view.result_not_recorded && (
        <div className="mt-2 text-emerald-400 text-xs font-bold">Shown to viewers{view.bracket ? ' · bracket updated' : ''}</div>
      )}
    </div>
  );
}
