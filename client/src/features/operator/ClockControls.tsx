import { Play, Pause, Square, Stethoscope } from 'lucide-react';
import type { FightView } from '../../api/protocol';
import { sendAction } from '../../api/socket';

const MEDICAL_MS = 120_000;

interface Props {
  view: FightView;
}

/** Start / STOP TIME / FIGHT / end round, and the medical timeout (§2). */
export default function ClockControls({ view }: Props) {
  const { clock, result, medical } = view;
  // The fight starts only when all three judges are connected (§1).
  const allJudgesConnected = view.judges.length === 3 && view.judges.every(j => j.connected);
  const canStart = (clock.phase === 'REST' || (clock.phase === 'NOT_STARTED' && allJudgesConnected)) && !result.final && !medical.active;
  const isRoundActive = clock.phase === 'RUNNING' || clock.phase === 'PAUSED';
  const canMedical = !result.final && (isRoundActive || clock.phase === 'REST');
  const btn = 'p-3 bg-zinc-800 rounded-full hover:bg-zinc-700 disabled:opacity-30 transition-all cursor-pointer';

  return (
    <div className="flex gap-2 items-center">
      <button
        disabled={!canStart}
        title={clock.phase === 'NOT_STARTED' && !allJudgesConnected ? 'Waiting for all 3 judges to connect' : 'Start round'}
        className={btn}
        onClick={() => sendAction('START_ROUND')}
      >
        <Play className="text-green-500" size={20} />
      </button>
      <button disabled={clock.phase !== 'RUNNING'} title="STOP TIME" className={btn} onClick={() => sendAction('PAUSE_ROUND')}>
        <Pause className="text-yellow-500" size={20} />
      </button>
      <button disabled={clock.phase !== 'PAUSED' || result.final || medical.active} title="FIGHT (resume)" className={btn} onClick={() => sendAction('RESUME_ROUND')}>
        <Play className="text-blue-500" size={20} />
      </button>
      <button disabled={!isRoundActive} title="End round" className={btn} onClick={() => sendAction('END_ROUND')}>
        <Square className="text-red-500" size={20} />
      </button>
      <button
        disabled={!medical.active && !canMedical}
        title={medical.active ? 'End medical timeout' : `Medical timeout (${MEDICAL_MS / 60_000} min)`}
        className={`px-3 py-2.5 rounded-full text-xs font-black flex items-center gap-1.5 disabled:opacity-30 cursor-pointer ${medical.active ? 'bg-cyan-500 text-black' : 'bg-zinc-800 text-cyan-400 hover:bg-zinc-700'}`}
        onClick={() => sendAction(medical.active ? 'MEDICAL_STOP' : 'MEDICAL_START')}
      >
        <Stethoscope size={16} /> {medical.active ? 'END MEDICAL' : 'MEDICAL'}
      </button>
    </div>
  );
}
