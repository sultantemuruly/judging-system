import { Fragment } from 'react';
import { OctagonX } from 'lucide-react';
import type { Corner, FightView } from '../../api/protocol';
import { sendAction } from '../../api/socket';
import { cornerName } from '../../shared/fightText';

interface Props {
  view: FightView;
  /** The next warning disqualifies: ask before sending it (§4). */
  onFourthWarning: (corner: Corner) => void;
  onStopFight: () => void;
}

const corners: Corner[] = ['Red', 'Blue'];

const tone = {
  Red: 'bg-red-950/60 border-red-800/60 hover:bg-red-900/60',
  Blue: 'bg-blue-950/60 border-blue-800/60 hover:bg-blue-900/60',
};

/** Referee decisions the operator enters, one row per corner: knockdown, warning, minus point; and stopping the fight (§4, §5). */
export default function RefereeActions({ view, onFourthWarning, onStopFight }: Props) {
  const { clock, result } = view;
  const over = result.final;
  const roundOn = clock.phase === 'RUNNING' || clock.phase === 'PAUSED';
  const started = clock.phase !== 'NOT_STARTED';
  const alertCorner = corners.find(c => view.corners[c].knockdown_alert);

  const warn = (c: Corner) => view.corners[c].next_warning_dq ? onFourthWarning(c) : sendAction('OFFICIAL_WARNING', { corner: c });

  const cell = (c: Corner, label: string, count: string | number, disabled: boolean, onClick: () => void) => (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`h-12 border rounded-lg flex items-center justify-between px-4 text-sm font-bold text-zinc-200 disabled:opacity-30 cursor-pointer ${tone[c]}`}
    >
      <span>+ {label}</span>
      <span className="text-white font-black text-xl tabular-nums">{count}</span>
    </button>
  );

  return (
    <div className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 flex-shrink-0">
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,1fr))] gap-2 items-center">
        <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Referee</div>
        <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Knockdowns <span className="normal-case">(round / fight)</span></div>
        <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Official warnings</div>
        <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Minus points (−3)</div>
        {corners.map(c => {
          const cv = view.corners[c];
          return (
            <Fragment key={c}>
              <div className="min-w-0">
                <div className={`font-black truncate ${c === 'Red' ? 'text-red-500' : 'text-blue-500'}`}>{cornerName(view, c)}</div>
                <div className="text-[11px] font-bold truncate">
                  {cv.penalty > 0 && <span className="text-zinc-400">−{cv.penalty} pts at every judge</span>}
                  {cv.next_warning_dq && <span className="text-red-400"> · next warning disqualifies</span>}
                </div>
              </div>
              {cell(c, 'Knockdown', `${cv.knockdowns_round} / ${cv.knockdowns_fight}`, !roundOn || over, () => sendAction('KNOCKDOWN', { corner: c }))}
              {cell(c, 'Warning', cv.warnings, over || !started, () => warn(c))}
              {cell(c, 'Minus point', cv.minus_points, over || !started, () => sendAction('MINUS_POINT', { corner: c }))}
            </Fragment>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          disabled={view.stoppage_methods.length === 0}
          onClick={onStopFight}
          className="h-11 px-5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 rounded-lg text-white font-bold text-sm flex items-center gap-2 cursor-pointer"
        >
          <OctagonX size={16} /> Stop the fight ({(view.stoppage_methods.length ? view.stoppage_methods : ['KO', 'RSC', 'DQ', 'AB']).join(', ')})…
        </button>
        {alertCorner && !over && (
          <div className="text-sm text-yellow-400 font-bold animate-pulse">
            {cornerName(view, alertCorner)}: one more knockdown stops the fight
          </div>
        )}
      </div>
    </div>
  );
}
