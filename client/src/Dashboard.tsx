import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type TournamentState, sendAction } from './socket';
import type { Corner, FightView } from './api/protocol';
import { Play, Pause, Square, RotateCcw, AlertTriangle, Shield, Swords, Settings, X, OctagonX } from 'lucide-react';
import ScoreDiffBar from './shared/ScoreDiffBar';
import { useCountdown } from './shared/useCountdown';
import { cornerName, formatMs, penaltySummary, resultBannerStyle, resultLabel, winnerTextColor } from './shared/fightText';

interface Props {
  view: FightView;
  tournament: TournamentState;
}

export default function Dashboard({ view, tournament }: Props) {
  const navigate = useNavigate();
  const { clock, corners, result } = view;
  const { remainingMs, isRest, secondsOut } = useCountdown(clock);

  const [showNewFight, setShowNewFight] = useState(false);
  const [hiddenBannerFor, setHiddenBannerFor] = useState('');
  const [roundsInput, setRoundsInput] = useState(3);
  const [roundDurationInput, setRoundDurationInput] = useState(120);
  const [restDurationInput, setRestDurationInput] = useState(60);

  const openNewFight = () => {
    setRoundsInput(clock.rounds);
    setRoundDurationInput(clock.round_ms / 1000);
    setRestDurationInput(clock.rest_ms / 1000);
    setShowNewFight(true);
  };

  const isRoundActive = clock.phase === 'RUNNING' || clock.phase === 'PAUSED';
  const fightOver = result.final;
  const canStart = (clock.phase === 'NOT_STARTED' || clock.phase === 'REST') && !fightOver;
  const limitCorner = (['Red', 'Blue'] as Corner[]).find(c => corners[c].knockdown_limit);
  const alertCorner = (['Red', 'Blue'] as Corner[]).find(c => corners[c].knockdown_alert);
  const penalties = [
    { key: 'red', text: penaltySummary('Red', corners.Red), className: 'text-red-400' },
    { key: 'blue', text: penaltySummary('Blue', corners.Blue), className: 'text-blue-400' },
  ].filter(p => p.text);

  return (
    <div className="h-screen w-screen flex flex-col items-center bg-zinc-950 p-2 sm:p-4 overscroll-none overflow-hidden">

      {/* Header controls */}
      <div className="w-full max-w-6xl flex justify-between items-center mb-2 border-b border-zinc-800 pb-2 flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-black text-white tracking-widest uppercase">
            Kickboxing <span className="text-zinc-500 font-light">Judging</span>
          </h1>
          <button
            onClick={() => navigate('/tournament/setup')}
            className="px-3 py-1.5 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold text-zinc-400 border border-zinc-700"
          >
            <Swords size={13} />
            Tournament
          </button>
          {tournament.active_match_category_id && (
            <button
              onClick={() => navigate(`/tournament/bracket/${tournament.active_match_category_id}`)}
              className="px-3 py-1.5 bg-emerald-900/40 rounded-lg hover:bg-emerald-900/60 transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold text-emerald-400 border border-emerald-800/50"
            >
              ← Back to Bracket
            </button>
          )}
        </div>
        <div className="flex gap-3 items-center">
          <button
            className="px-4 py-2 bg-zinc-800 rounded-xl hover:bg-zinc-700 transition-all cursor-pointer flex items-center gap-2 text-sm font-bold text-zinc-300 border border-zinc-700"
            onClick={openNewFight}
          >
            <RotateCcw size={16} />
            New Fight
          </button>

          <div className="w-px h-8 bg-zinc-800" />

          <button
            disabled={!canStart}
            title="Start round"
            className="p-3 bg-zinc-800 rounded-full hover:bg-zinc-700 disabled:opacity-30 transition-all cursor-pointer"
            onClick={() => sendAction('START_ROUND')}
          >
            <Play className="text-green-500" size={20} />
          </button>
          <button
            disabled={clock.phase !== 'RUNNING'}
            title="Pause (STOP TIME)"
            className="p-3 bg-zinc-800 rounded-full hover:bg-zinc-700 disabled:opacity-30 transition-all cursor-pointer"
            onClick={() => sendAction('PAUSE_ROUND')}
          >
            <Pause className="text-yellow-500" size={20} />
          </button>
          <button
            disabled={clock.phase !== 'PAUSED' || fightOver}
            title="Resume (FIGHT)"
            className="p-3 bg-zinc-800 rounded-full hover:bg-zinc-700 disabled:opacity-30 transition-all cursor-pointer"
            onClick={() => sendAction('RESUME_ROUND')}
          >
            <Play className="text-blue-500" size={20} />
          </button>
          <button
            disabled={!isRoundActive}
            title="End round"
            className="p-3 bg-zinc-800 rounded-full hover:bg-zinc-700 disabled:opacity-30 transition-all cursor-pointer"
            onClick={() => sendAction('END_ROUND')}
          >
            <Square className="text-red-500" size={20} />
          </button>
        </div>
      </div>

      {/* New standalone fight: reset and pick its format (bracket fights use their category's format) */}
      {showNewFight && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <h2 className="text-xl font-black text-white mb-2 flex items-center gap-2">
              <Settings size={20} className="text-zinc-400" /> New Fight
            </h2>
            <p className="text-zinc-400 text-sm mb-6">Resets scores, warnings and knockdowns. An unfinished bracket match goes back to the queue. Bracket fights are started from the bracket and use their category's format.</p>

            <div className="grid grid-cols-3 gap-3 mb-8">
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider">Rounds
                <select value={roundsInput} onChange={(e) => setRoundsInput(Number(e.target.value))}
                  className="mt-2 w-full bg-zinc-950 border border-zinc-800 text-white rounded-lg px-3 py-2.5 outline-none focus:border-emerald-500">
                  {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider">Round
                <select value={roundDurationInput} onChange={(e) => setRoundDurationInput(Number(e.target.value))}
                  className="mt-2 w-full bg-zinc-950 border border-zinc-800 text-white rounded-lg px-3 py-2.5 outline-none focus:border-emerald-500">
                  {[60, 90, 120, 150, 180].map(n => <option key={n} value={n}>{formatMs(n * 1000)}</option>)}
                </select>
              </label>
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider">Rest
                <select value={restDurationInput} onChange={(e) => setRestDurationInput(Number(e.target.value))}
                  className="mt-2 w-full bg-zinc-950 border border-zinc-800 text-white rounded-lg px-3 py-2.5 outline-none focus:border-emerald-500">
                  {[30, 45, 60, 90, 120].map(n => <option key={n} value={n}>{formatMs(n * 1000)}</option>)}
                </select>
              </label>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                className="px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl font-bold hover:bg-zinc-700 transition-all cursor-pointer"
                onClick={() => setShowNewFight(false)}
              >
                Cancel
              </button>
              <button
                className="px-5 py-2.5 bg-red-600 text-white rounded-xl font-bold hover:bg-red-500 transition-all cursor-pointer"
                onClick={() => {
                  sendAction('NEW_FIGHT', { rounds: roundsInput, round_seconds: roundDurationInput, rest_seconds: restDurationInput });
                  setShowNewFight(false);
                }}
              >
                Reset & Start New Fight
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main scoreboard */}
      <div className="flex-1 w-full max-w-6xl flex flex-col min-h-0 justify-between">

        {/* Timer + Round */}
        <div className="text-center mb-2 flex-shrink-0 mt-1">
          {(view.red_name || view.blue_name) && (
            <div className="mb-1">
              {view.category && (
                <div className="text-zinc-400 text-sm md:text-base font-black uppercase tracking-[0.2em] mb-1">{view.category}</div>
              )}
              <div className="flex items-center justify-center gap-6">
                <div className="text-right flex-1">
                  <div className="text-red-500 text-4xl md:text-5xl font-black uppercase tracking-tight leading-none">{view.red_name || 'RED'}</div>
                </div>
                <div className="text-zinc-600 font-black text-2xl flex-shrink-0">VS</div>
                <div className="text-left flex-1">
                  <div className="text-blue-500 text-4xl md:text-5xl font-black uppercase tracking-tight leading-none">{view.blue_name || 'BLUE'}</div>
                </div>
              </div>
            </div>
          )}
          <div className="flex items-end justify-center gap-4 mt-2">
            <div className="text-zinc-400 text-lg md:text-xl uppercase tracking-widest font-black pb-2 text-right w-24">R{Math.max(clock.round, 1)}/{clock.rounds}</div>
            <div className="text-7xl md:text-8xl font-black text-white font-mono tracking-tighter leading-none">
              {formatMs(remainingMs)}
            </div>
            <div className={`text-sm md:text-base font-black pb-2 uppercase w-24 text-left ${isRest ? 'text-cyan-400 animate-pulse' : 'text-zinc-500'}`}>
              {secondsOut ? 'SECONDS OUT' : isRest ? 'REST PHASE' : clock.phase.replace('_', ' ')}
            </div>
          </div>
        </div>

        {/* Referee Controls: Knockdowns + Warnings */}
        <div className="w-full grid grid-cols-2 gap-3 mb-3 flex-shrink-0">

          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 px-3">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 flex items-center gap-2">
              <Shield size={12} />
              Knockdowns (round)
            </div>
            <div className="flex gap-2">
              <button
                disabled={!isRoundActive || fightOver}
                onClick={() => sendAction('KNOCKDOWN', { corner: 'Red' })}
                className="flex-1 h-10 bg-red-900/40 border border-red-800/50 rounded-lg flex items-center justify-between px-3 hover:bg-red-900/60 disabled:opacity-30 transition-all cursor-pointer"
              >
                <span className="text-red-400 font-bold text-xs">RED KD</span>
                <span className="text-white font-black text-xl leading-none pt-0.5">{corners.Red.knockdowns_round}</span>
              </button>
              <button
                disabled={!isRoundActive || fightOver}
                onClick={() => sendAction('KNOCKDOWN', { corner: 'Blue' })}
                className="flex-1 h-10 bg-blue-900/40 border border-blue-800/50 rounded-lg flex items-center justify-between px-3 hover:bg-blue-900/60 disabled:opacity-30 transition-all cursor-pointer"
              >
                <span className="text-blue-400 font-bold text-xs">BLUE KD</span>
                <span className="text-white font-black text-xl leading-none pt-0.5">{corners.Blue.knockdowns_round}</span>
              </button>
            </div>
            {limitCorner && !fightOver ? (
              <button
                onClick={() => sendAction('STOPPAGE', { corner: limitCorner === 'Red' ? 'Blue' : 'Red', method: 'RSC' })}
                className="mt-1.5 w-full py-1.5 bg-yellow-500 text-black rounded-lg font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer hover:bg-yellow-400"
              >
                <OctagonX size={14} /> Knockdown limit — stop fight: {limitCorner === 'Red' ? 'BLUE' : 'RED'} wins RSC
              </button>
            ) : alertCorner && !fightOver && (
              <div className="mt-1 text-[10px] text-yellow-400 font-bold animate-pulse leading-none">
                ⚠ {alertCorner.toUpperCase()}: one more knockdown reaches the limit
              </div>
            )}
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 px-3">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 flex items-center gap-2">
              <AlertTriangle size={12} />
              Official Warnings
            </div>
            <div className="flex gap-2">
              <button
                disabled={fightOver || clock.phase === 'NOT_STARTED'}
                onClick={() => sendAction('OFFICIAL_WARNING', { corner: 'Red' })}
                className="flex-1 h-10 bg-red-900/40 border border-red-800/50 rounded-lg flex items-center justify-between px-3 hover:bg-red-900/60 disabled:opacity-30 transition-all cursor-pointer"
              >
                <span className="text-red-400 font-bold text-xs">RED</span>
                <span className="text-white font-black text-xl leading-none pt-0.5">{corners.Red.warnings}</span>
              </button>
              <button
                disabled={fightOver || clock.phase === 'NOT_STARTED'}
                onClick={() => sendAction('OFFICIAL_WARNING', { corner: 'Blue' })}
                className="flex-1 h-10 bg-blue-900/40 border border-blue-800/50 rounded-lg flex items-center justify-between px-3 hover:bg-blue-900/60 disabled:opacity-30 transition-all cursor-pointer"
              >
                <span className="text-blue-400 font-bold text-xs">BLUE</span>
                <span className="text-white font-black text-xl leading-none pt-0.5">{corners.Blue.warnings}</span>
              </button>
            </div>
            {penalties.length > 0 && (
              <div className="mt-1.5 text-xs font-bold leading-tight flex gap-2">
                {penalties.map(p => <span key={p.key} className={p.className}>{p.text}</span>)}
              </div>
            )}
          </div>
        </div>

        {/* Per-Judge Scorecards with Difference Bar */}
        <div className="w-full flex-1 min-h-0 flex flex-col justify-end gap-2 pb-2">
          {view.judges.map((judge) => {
            const diff = judge.total.red - judge.total.blue;
            return (
              <div key={judge.seat} className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 px-4 flex items-center gap-4 shadow-sm">
                <div className="w-20 text-center flex-shrink-0 border-r border-zinc-800 pr-4">
                  <div className="text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5">
                    JUDGE <span className="text-zinc-500 text-base">{judge.seat}</span>
                  </div>
                  {judge.decision_needed && (
                    <div className="text-[9px] text-yellow-400 font-bold uppercase animate-pulse">Deciding…</div>
                  )}
                  {judge.verdict && (
                    <div className={`text-[10px] font-black uppercase ${winnerTextColor(judge.verdict)}`}>
                      {judge.verdict}{judge.decided ? ' (decision)' : ''}
                    </div>
                  )}
                </div>

                <div className="w-16 text-center flex-shrink-0">
                  <div className="text-red-500 text-[10px] font-bold uppercase tracking-widest mb-0.5">Red</div>
                  <div className="text-white text-4xl font-black leading-none">{judge.total.red}</div>
                </div>

                <div className="flex-1 flex flex-col justify-center bg-zinc-950/40 rounded-lg px-3 py-1.5 border border-zinc-800/50">
                  <div className="flex items-center justify-center mb-1">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                      {diff === 0 ? 'EVEN' : `DIFF: ${Math.abs(diff)}`}
                    </span>
                  </div>
                  <ScoreDiffBar diff={diff} />
                </div>

                <div className="w-16 text-center flex-shrink-0">
                  <div className="text-blue-500 text-[10px] font-bold uppercase tracking-widest mb-0.5">Blue</div>
                  <div className="text-white text-4xl font-black leading-none">{judge.total.blue}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Result Announcement */}
        {result.final && hiddenBannerFor !== view.fight_id && (
          <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4">
            <div className={`relative text-center p-12 rounded-3xl max-w-3xl mx-auto w-full shadow-2xl border-2 animate-in zoom-in duration-300 ${resultBannerStyle(result.winner)}`}>
              <button
                onClick={() => setHiddenBannerFor(view.fight_id)}
                className="absolute top-6 right-6 text-zinc-500 hover:text-white transition-colors cursor-pointer bg-black/20 p-2 rounded-full hover:bg-black/40"
                title="Close Banner"
              >
                <X size={24} />
              </button>
              <div className="text-lg font-bold mb-3 uppercase tracking-[0.3em] text-zinc-400/80">
                🏆 Match Winner 🏆
              </div>
              <div className={`text-6xl md:text-7xl font-black uppercase tracking-tight ${winnerTextColor(result.winner)}`}>
                {cornerName(view, result.winner)}
              </div>
              <div className="text-zinc-300 text-xl font-bold mt-6 uppercase tracking-[0.2em] bg-black/20 inline-block px-8 py-3 rounded-full border border-white/5 shadow-inner">
                {resultLabel(result)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
