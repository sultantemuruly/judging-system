import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw, Swords, WifiOff } from 'lucide-react';
import type { Corner, FightView, Method, TournamentState } from '../../api/protocol';
import { sendAction, subscribeToResults } from '../../api/socket';
import { useConnection } from '../../shared/useConnection';
import ConfirmDialog from '../../shared/ConfirmDialog';
import { cornerName } from '../../shared/fightText';
import ActionLog from './ActionLog';
import ClockControls from './ClockControls';
import FightClock from './FightClock';
import JudgeCards from './JudgeCards';
import NewFightDialog from './NewFightDialog';
import RefereeActions from './RefereeActions';
import ResultPanel from './ResultPanel';
import StoppageDialog from './StoppageDialog';

interface Props {
  view: FightView;
  tournament: TournamentState;
}

type Dialog =
  | { kind: 'newFight' }
  | { kind: 'fourthWarning'; corner: Corner }
  | { kind: 'stoppage'; initial?: { winner: Corner; method: Method } };

const reasons: Record<string, string> = {
  judges_not_connected: 'All 3 judges must be connected to start the fight',
  no_connection: 'No connection to the server',
};

export default function OperatorScreen({ view, tournament }: Props) {
  const navigate = useNavigate();
  const { status } = useConnection();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState('');
  // Knockdown-limit prompts the operator dismissed, per fight and count.
  const [dismissedKD, setDismissedKD] = useState<string[]>([]);

  useEffect(() => subscribeToResults((type, r) => {
    if (!r.ok) setNotice(reasons[r.reason ?? ''] ?? `${type}: ${r.reason}`);
  }), []);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // The system proposes RSC at the knockdown limit; the operator decides (§5).
  const limitCorner = (['Red', 'Blue'] as Corner[]).find(c => view.corners[c].knockdown_limit);
  const kdKey = limitCorner ? `${view.fight_id}:${limitCorner}:${view.corners[limitCorner].knockdowns_fight}` : '';
  const showKDPrompt = limitCorner && !view.result.final && !dismissedKD.includes(kdKey) && !dialog;

  return (
    <div className="h-screen w-screen flex flex-col items-center bg-zinc-950 p-2 sm:p-4 overflow-hidden">
      {status !== 'open' && (
        <div className="fixed top-0 inset-x-0 z-[90] bg-red-600 text-white font-black text-center py-1.5 flex items-center justify-center gap-2">
          <WifiOff size={16} /> No connection to the server — reconnecting…
        </div>
      )}
      {notice && (
        <div className="fixed bottom-4 inset-x-0 z-[90] flex justify-center pointer-events-none">
          <div className="bg-yellow-500 text-black font-bold rounded-xl px-5 py-2.5 shadow-xl">{notice}</div>
        </div>
      )}

      {/* Header */}
      <div className="w-full max-w-7xl flex justify-between items-center mb-2 border-b border-zinc-800 pb-2 flex-shrink-0 gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-black text-white tracking-widest uppercase whitespace-nowrap">
            Kickboxing <span className="text-zinc-500 font-light">Judging</span>
          </h1>
          <button
            onClick={() => navigate('/tournament/setup')}
            className="px-3 py-1.5 bg-zinc-800 rounded-lg hover:bg-zinc-700 cursor-pointer flex items-center gap-1.5 text-xs font-bold text-zinc-400 border border-zinc-700"
          >
            <Swords size={13} /> Tournament
          </button>
          {tournament.active_match_category_id && (
            <button
              onClick={() => navigate(`/tournament/bracket/${tournament.active_match_category_id}`)}
              className="px-3 py-1.5 bg-emerald-900/40 rounded-lg hover:bg-emerald-900/60 cursor-pointer text-xs font-bold text-emerald-400 border border-emerald-800/50"
            >
              ← Back to Bracket
            </button>
          )}
        </div>
        <div className="flex gap-3 items-center">
          <div className="flex gap-1.5" title="Judge phones">
            {view.judges.map(j => (
              <span key={j.seat} className={`px-2 py-1 rounded-lg text-[11px] font-black border ${j.connected ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50' : 'bg-red-900/40 text-red-300 border-red-700/50 animate-pulse'}`}>
                J{j.seat} {j.connected ? '●' : '○'}
              </span>
            ))}
          </div>
          <button
            className="px-4 py-2 bg-zinc-800 rounded-xl hover:bg-zinc-700 cursor-pointer flex items-center gap-2 text-sm font-bold text-zinc-300 border border-zinc-700"
            onClick={() => setDialog({ kind: 'newFight' })}
          >
            <RotateCcw size={16} /> New Fight
          </button>
          <div className="w-px h-8 bg-zinc-800" />
          <ClockControls view={view} />
        </div>
      </div>

      <div className="flex-1 w-full max-w-7xl flex gap-4 min-h-0">
        <div className="flex-1 flex flex-col gap-3 min-h-0 justify-between">
          <FightClock view={view} />
          <RefereeActions
            view={view}
            onFourthWarning={corner => setDialog({ kind: 'fourthWarning', corner })}
            onStopFight={() => setDialog({ kind: 'stoppage' })}
          />
          <JudgeCards view={view} />
        </div>
        <div className="w-80 flex flex-col gap-3 min-h-0">
          <ResultPanel view={view} />
          <ActionLog view={view} />
        </div>
      </div>

      {dialog?.kind === 'newFight' && <NewFightDialog clock={view.clock} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'stoppage' && <StoppageDialog view={view} initial={dialog.initial} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'fourthWarning' && (
        <ConfirmDialog
          title={`4th warning: disqualify ${cornerName(view, dialog.corner)}?`}
          confirmLabel="Give 4th warning (DQ)"
          danger
          onConfirm={() => { sendAction('OFFICIAL_WARNING', { corner: dialog.corner }); setDialog(null); }}
          onCancel={() => setDialog(null)}
        >
          The 4th official warning disqualifies the fighter: {cornerName(view, dialog.corner === 'Red' ? 'Blue' : 'Red')} wins by DQ. It can still be undone until the result is confirmed.
        </ConfirmDialog>
      )}
      {showKDPrompt && limitCorner && (
        <ConfirmDialog
          title={`Knockdown limit: ${cornerName(view, limitCorner)}`}
          confirmLabel={`Stop: ${cornerName(view, limitCorner === 'Red' ? 'Blue' : 'Red')} wins RSC`}
          danger
          onConfirm={() => {
            sendAction('STOPPAGE', { corner: limitCorner === 'Red' ? 'Blue' : 'Red', method: 'RSC' });
            setDismissedKD(d => [...d, kdKey]);
          }}
          onCancel={() => setDismissedKD(d => [...d, kdKey])}
        >
          {view.corners[limitCorner].knockdowns_round} knockdowns in this round, {view.corners[limitCorner].knockdowns_fight} in the fight. The rules stop the fight here.
        </ConfirmDialog>
      )}
    </div>
  );
}
