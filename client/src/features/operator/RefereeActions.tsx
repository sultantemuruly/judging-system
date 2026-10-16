import { AlertTriangle, MinusCircle, OctagonX, Shield } from 'lucide-react';
import type { Corner, FightView } from '../../api/protocol';
import { sendAction } from '../../api/socket';
import { penaltySummary } from '../../shared/fightText';

interface Props {
  view: FightView;
  /** The next warning disqualifies: ask before sending it (§4). */
  onFourthWarning: (corner: Corner) => void;
  onStopFight: () => void;
}

const corners: Corner[] = ['Red', 'Blue'];

const tone = {
  Red: 'bg-red-900/40 border-red-800/50 hover:bg-red-900/60 text-red-400',
  Blue: 'bg-blue-900/40 border-blue-800/50 hover:bg-blue-900/60 text-blue-400',
};

/** Referee decisions the operator enters: knockdowns, warnings, minus points, stoppage (§4, §5). */
export default function RefereeActions({ view, onFourthWarning, onStopFight }: Props) {
  const { clock, result } = view;
  const over = result.final;
  const roundOn = clock.phase === 'RUNNING' || clock.phase === 'PAUSED';
  const started = clock.phase !== 'NOT_STARTED';
  const alertCorner = corners.find(c => view.corners[c].knockdown_alert);

  const warn = (c: Corner) => view.corners[c].next_warning_dq ? onFourthWarning(c) : sendAction('OFFICIAL_WARNING', { corner: c });
  const button = (c: Corner) => `flex-1 h-10 border rounded-lg flex items-center justify-between px-3 disabled:opacity-30 transition-all cursor-pointer ${tone[c]}`;

  return (
    <div className="w-full grid grid-cols-3 gap-3 flex-shrink-0">
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 px-3">
        <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 flex items-center gap-2">
          <Shield size={12} /> Knockdowns (round / fight)
        </div>
        <div className="flex gap-2">
          {corners.map(c => (
            <button key={c} disabled={!roundOn || over} onClick={() => sendAction('KNOCKDOWN', { corner: c })} className={button(c)}>
              <span className="font-bold text-xs">{c.toUpperCase()} KD</span>
              <span className="text-white font-black text-xl leading-none">
                {view.corners[c].knockdowns_round}<span className="text-zinc-500 text-sm">/{view.corners[c].knockdowns_fight}</span>
              </span>
            </button>
          ))}
        </div>
        {alertCorner && !over && (
          <div className="mt-1 text-[11px] text-yellow-400 font-bold animate-pulse leading-tight">
            ⚠ {alertCorner.toUpperCase()}: one more knockdown = stoppage
          </div>
        )}
      </div>

      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 px-3">
        <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 flex items-center gap-2">
          <AlertTriangle size={12} /> Official warnings · minus points
        </div>
        <div className="grid grid-cols-2 gap-2">
          {corners.map(c => (
            <button key={c} disabled={over || !started} onClick={() => warn(c)} className={button(c)} title="Official warning">
              <span className="font-bold text-xs">{c.toUpperCase()} W</span>
              <span className="text-white font-black text-xl leading-none">{view.corners[c].warnings}</span>
            </button>
          ))}
          {corners.map(c => (
            <button key={c} disabled={over || !started} onClick={() => sendAction('MINUS_POINT', { corner: c })} className={`${button(c)} h-8`} title="Direct minus point (−3)">
              <span className="font-bold text-[11px] flex items-center gap-1"><MinusCircle size={12} /> {c.toUpperCase()} −3</span>
              <span className="text-white font-black text-sm">{view.corners[c].minus_points}</span>
            </button>
          ))}
        </div>
        <div className="mt-1 text-[11px] font-bold leading-tight flex gap-3">
          <span className="text-red-400">{penaltySummary('Red', view.corners.Red)}</span>
          <span className="text-blue-400">{penaltySummary('Blue', view.corners.Blue)}</span>
        </div>
      </div>

      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 px-3 flex flex-col">
        <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 flex items-center gap-2">
          <OctagonX size={12} /> Stop the fight
        </div>
        <button
          disabled={over || !started}
          onClick={onStopFight}
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 rounded-lg text-white font-black text-sm cursor-pointer"
        >
          KO · RSC · DQ · AB…
        </button>
      </div>
    </div>
  );
}
