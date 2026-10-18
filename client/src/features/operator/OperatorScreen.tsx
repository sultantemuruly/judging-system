import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw, WifiOff } from 'lucide-react';
import type { Corner, FightView, Method, TournamentState } from '../../api/protocol';
import { sendAction, subscribeToResults } from '../../api/socket';
import { useConnection } from '../../shared/useConnection';
import ConfirmDialog from '../../shared/ConfirmDialog';
import NavBar from '../../shared/NavBar';
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
  server_error: 'Server could not save the action (disk?) — nothing changed, try again',
  result_not_recorded: 'Result confirmed, but the bracket could not record it — set the winner on the bracket screen',
};

export default function OperatorScreen({ view, tournament }: Props) {
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
    <div className="h-screen w-screen flex flex-col items-center bg-zinc-950 overflow-hidden">
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

      <NavBar>
        {tournament.active_match_category_id && (
          <Link
            to={`/tournament/bracket/${tournament.active_match_category_id}`}
            className="text-sm font-bold text-emerald-400 hover:text-emerald-300"
          >
            Open this fight's bracket
          </Link>
        )}
        <button
          className="px-4 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 cursor-pointer flex items-center gap-2 text-sm font-bold text-zinc-300"
          onClick={() => setDialog({ kind: 'newFight' })}
        >
          <RotateCcw size={15} /> New fight
        </button>
      </NavBar>

      <div className="flex-1 w-full max-w-7xl flex gap-4 min-h-0 p-3 sm:p-4">
        <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto">
          <FightClock view={view} />
          <ClockControls view={view} />
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
