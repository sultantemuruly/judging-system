import { Pause, Play, Square, Stethoscope } from 'lucide-react';
import type { FightView } from '../../api/protocol';
import { sendAction } from '../../api/socket';

const MEDICAL_MS = 120_000;

interface Step {
  label: string;
  action: string;
  icon: typeof Play;
  tone: string;
  disabled?: boolean;
  hint?: string;
}

/** The one thing the operator does next with the clock, by phase (§2). */
function nextStep(view: FightView): Step | null {
  const { clock, result, medical } = view;
  if (result.final) return null;
  // The fight starts only when all three judges are connected (§1).
  const judgesReady = view.judges.length === 3 && view.judges.every(j => j.connected);
  const start = 'bg-emerald-600 hover:bg-emerald-500 text-white';
  switch (clock.phase) {
    case 'NOT_STARTED':
      return { label: 'Start round 1', action: 'START_ROUND', icon: Play, tone: start, disabled: !judgesReady, hint: judgesReady ? undefined : 'Waiting for all 3 judges to connect' };
    case 'REST':
      return { label: `Start round ${clock.round + 1}`, action: 'START_ROUND', icon: Play, tone: start, disabled: medical.active };
    case 'RUNNING':
      return { label: 'Stop time', action: 'PAUSE_ROUND', icon: Pause, tone: 'bg-yellow-500 hover:bg-yellow-400 text-black' };
    case 'PAUSED':
      return { label: 'Fight (resume)', action: 'RESUME_ROUND', icon: Play, tone: start, disabled: medical.active };
    default:
      return null;
  }
}

/** Clock buttons under the timer: the next step, end round, medical timeout. */
export default function ClockControls({ view }: { view: FightView }) {
  const { clock, result, medical } = view;
  const step = nextStep(view);
  const roundOn = clock.phase === 'RUNNING' || clock.phase === 'PAUSED';
  const canMedical = !result.final && (roundOn || clock.phase === 'REST');
  const secondary = 'h-14 px-5 rounded-xl font-bold flex items-center gap-2 border disabled:opacity-30 cursor-pointer';

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex gap-3 items-center justify-center">
        {step && (
          <button
            disabled={step.disabled}
            onClick={() => sendAction(step.action)}
            className={`h-14 min-w-64 px-8 rounded-xl text-lg font-black uppercase tracking-wide flex items-center justify-center gap-2 disabled:opacity-30 cursor-pointer ${step.tone}`}
          >
            <step.icon size={22} /> {step.label}
          </button>
        )}
        {roundOn && (
          <button onClick={() => sendAction('END_ROUND')} className={`${secondary} bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800`}>
            <Square size={16} className="text-red-500" /> End round
          </button>
        )}
        {(canMedical || medical.active) && (
          <button
            onClick={() => sendAction(medical.active ? 'MEDICAL_STOP' : 'MEDICAL_START')}
            title={`Medical timeout (${MEDICAL_MS / 60_000} min)`}
            className={`${secondary} ${medical.active ? 'bg-cyan-500 border-cyan-400 text-black' : 'bg-zinc-900 border-zinc-700 text-cyan-400 hover:bg-zinc-800'}`}
          >
            <Stethoscope size={16} /> {medical.active ? 'End medical' : 'Medical'}
          </button>
        )}
      </div>
      {step?.hint && <div className="text-sm font-bold text-yellow-400">{step.hint}</div>}
    </div>
  );
}
