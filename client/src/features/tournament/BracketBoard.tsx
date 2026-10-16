import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Bracket, BracketMatch, CorrectionReason, TournamentState, WeightCategory } from '../../api/protocol';
import { sendAction } from '../../api/socket';
import BracketTree from './BracketTree';

const reasons: { value: CorrectionReason; label: string }[] = [
  { value: 'corners_switched', label: 'Corners switched' },
  { value: 'operator_error', label: 'Operator error' },
  { value: 'protest', label: 'Protest upheld' },
];

const refusals: Record<string, string> = {
  fight_in_progress: 'Another fight is on the ring. Finish and confirm it (or cancel it before it starts) first.',
  next_match_started: "The winner's next fight has already started: this result can no longer be corrected.",
  match_not_ready: 'Both fighters must be known first.',
  match_decided: 'This match is already decided.',
  bad_reason: 'Choose a reason.',
};

type Dialog = { kind: 'walkover' | 'correct'; match: BracketMatch };

/** A category's bracket with its actions: start a fight, walkover, result correction (§8). */
export default function BracketBoard({ tournament, category, bracket }: { tournament: TournamentState; category: WeightCategory; bracket: Bracket }) {
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const report = (ok: boolean, reason?: string) => {
    if (!ok) setNotice(refusals[reason ?? ''] ?? `Refused: ${reason}`);
    return ok;
  };

  const start = async (matchId: string) => {
    const r = await sendAction('START_BRACKET_MATCH', { category_id: category.id, match_id: matchId });
    if (report(r.ok, r.reason)) navigate('/');
  };

  return (
    <>
      <BracketTree
        bracket={bracket}
        activeBracketMatchId={tournament.active_match_bracket_match_id}
        onStartMatch={start}
        onOpenRing={() => navigate('/')}
        onWalkover={match => setDialog({ kind: 'walkover', match })}
        onCorrect={match => setDialog({ kind: 'correct', match })}
      />
      {notice && (
        <div className="fixed bottom-4 inset-x-0 z-[90] flex justify-center pointer-events-none">
          <div className="bg-yellow-500 text-black font-bold rounded-xl px-5 py-2.5 shadow-xl max-w-xl text-center">{notice}</div>
        </div>
      )}
      {dialog && (
        <ResultDialog
          dialog={dialog}
          onClose={() => setDialog(null)}
          onSubmit={async (winnerId, reason) => {
            const r = dialog.kind === 'walkover'
              ? await sendAction('WALKOVER', { category_id: category.id, match_id: dialog.match.id, winner_id: winnerId })
              : await sendAction('CORRECT_RESULT', { category_id: category.id, match_id: dialog.match.id, winner_id: winnerId, reason });
            if (report(r.ok, r.reason)) setDialog(null);
          }}
        />
      )}
    </>
  );
}

function ResultDialog({ dialog, onClose, onSubmit }: {
  dialog: Dialog;
  onClose: () => void;
  onSubmit: (winnerId: string, reason: CorrectionReason | '') => void;
}) {
  const { match, kind } = dialog;
  const [winnerId, setWinnerId] = useState(kind === 'correct' ? (match.winner_id === match.fighter_red_id ? match.fighter_blue_id : match.fighter_red_id) : '');
  const [reason, setReason] = useState<CorrectionReason | ''>('');
  const ready = winnerId !== '' && (kind === 'walkover' || reason !== '');
  const fighters = [
    { id: match.fighter_red_id, name: match.fighter_red_name, tone: 'bg-red-600 border-red-400' },
    { id: match.fighter_blue_id, name: match.fighter_blue_name, tone: 'bg-blue-600 border-blue-400' },
  ];

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-7 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-black text-white mb-1">{kind === 'walkover' ? 'Win by walkover (WO)' : 'Correct the result'}</h2>
        <p className="text-zinc-400 text-sm mb-5">
          {kind === 'walkover'
            ? 'The opponent did not show up or withdrew. Choose the fighter who is present.'
            : 'Chief judge only. Allowed while the winner\'s next fight has not started; the bracket is updated and the old result is kept.'}
        </p>
        <div className="grid grid-cols-2 gap-3 mb-5">
          {fighters.map(f => (
            <button
              key={f.id}
              onClick={() => setWinnerId(f.id)}
              className={`py-3 px-2 rounded-xl font-black border-2 truncate cursor-pointer ${winnerId === f.id ? `${f.tone} text-white` : 'bg-zinc-800 border-zinc-700 text-zinc-300'}`}
            >
              {f.name}{kind === 'correct' && f.id === match.winner_id ? ' (current)' : ''}
            </button>
          ))}
        </div>
        {kind === 'correct' && (
          <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-6">Reason
            <select value={reason} onChange={e => setReason(e.target.value as CorrectionReason)}
              className="mt-2 w-full bg-zinc-950 border border-zinc-800 text-white rounded-lg px-3 py-2.5 normal-case">
              <option value="">— choose —</option>
              {reasons.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
        )}
        <div className="flex gap-3 justify-end">
          <button className="px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl font-bold hover:bg-zinc-700 cursor-pointer" onClick={onClose}>Cancel</button>
          <button
            disabled={!ready || (kind === 'correct' && winnerId === match.winner_id)}
            onClick={() => onSubmit(winnerId, reason)}
            className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-30 text-white rounded-xl font-bold cursor-pointer"
          >
            {kind === 'walkover' ? 'Record walkover' : 'Correct result'}
          </button>
        </div>
      </div>
    </div>
  );
}
