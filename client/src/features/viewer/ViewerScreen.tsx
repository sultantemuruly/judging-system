import type { Corner, FightView } from '../../api/protocol';
import { AlertTriangle, Shield } from 'lucide-react';
import ScoreDiffBar from '../../shared/ScoreDiffBar';
import { useCountdown, useRemaining } from '../../shared/useCountdown';
import { cornerName, formatMs, penaltySummary, resultBannerStyle, resultLabel, winnerTextColor } from '../../shared/fightText';

interface Props {
  view: FightView;
}

export default function ViewerScreen({ view }: Props) {
  const { clock, corners, result, medical } = view;
  const { remainingMs, isRest, secondsOut } = useCountdown(clock);
  const medicalLeft = useRemaining(medical.active ? medical.ends_at : 0, 120_000);
  // The winner is shown only after the operator confirms the result (§7).
  const showWinner = result.final && result.confirmed;

  const statusColor =
    isRest ? 'text-cyan-400' :
    clock.phase === 'RUNNING' ? 'text-green-400' :
    clock.phase === 'PAUSED' ? 'text-yellow-400' :
    clock.phase === 'ENDED' ? 'text-red-400' :
    'text-zinc-500';
  const statusPulse = (clock.phase === 'RUNNING' || isRest) ? 'animate-pulse' : '';
  const alertCorner = (['Red', 'Blue'] as Corner[]).find(c => corners[c].knockdown_alert || corners[c].knockdown_limit);
  const penalties = [
    { key: 'red', text: penaltySummary('Red', corners.Red), className: 'text-red-400 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]' },
    { key: 'blue', text: penaltySummary('Blue', corners.Blue), className: 'text-blue-400 drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]' },
  ].filter(p => p.text);
  const showScores = view.live_scores || showWinner;

  return (
    <div className="min-h-screen flex flex-col items-center bg-zinc-950 p-6 overscroll-none">

      {/* Header */}
      <div className="w-full max-w-7xl flex justify-between items-center mb-8 border-b border-zinc-800 pb-4">
        <h1 className="text-3xl font-black text-white tracking-widest uppercase">
          Kickboxing <span className="text-zinc-500 font-light">Live</span>
        </h1>
        {view.category && <div className="text-zinc-400 text-sm font-bold uppercase tracking-widest">{view.category}</div>}
      </div>

      <div className="flex-1 w-full max-w-7xl flex flex-col">

        {(view.red_name || view.blue_name) && (
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-8">
              <div className="text-red-500 text-3xl font-black uppercase drop-shadow-[0_0_20px_rgba(239,68,68,0.3)]">
                {view.red_name || 'RED'}
              </div>
              <div className="text-zinc-600 font-bold text-xl">VS</div>
              <div className="text-blue-500 text-3xl font-black uppercase drop-shadow-[0_0_20px_rgba(59,130,246,0.3)]">
                {view.blue_name || 'BLUE'}
              </div>
            </div>
          </div>
        )}

        {/* Timer + Round */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-4 mb-2">
            <div className="h-px flex-1 max-w-32 bg-gradient-to-r from-transparent to-zinc-700" />
            <h2 className="text-zinc-400 text-xl uppercase tracking-[0.3em] font-semibold">
              Round {Math.max(clock.round, 1)} / {clock.rounds}
            </h2>
            <div className="h-px flex-1 max-w-32 bg-gradient-to-l from-transparent to-zinc-700" />
          </div>
          <div className="text-9xl font-black text-white font-mono tracking-tighter drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]">
            {formatMs(remainingMs)}
          </div>
          <div className={`mt-2 text-sm font-bold uppercase tracking-widest ${statusColor} ${statusPulse}`}>
            {clock.phase === 'RUNNING' && '● '}
            {secondsOut ? 'SECONDS OUT' : isRest ? 'REST PHASE' : clock.phase.replace('_', ' ')}
          </div>
          {medical.active && (
            <div className="mt-4 inline-flex items-center gap-4 bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 rounded-2xl px-6 py-2 font-black text-xl">
              MEDICAL TIMEOUT <span className="font-mono text-3xl text-white">{formatMs(medicalLeft)}</span>
            </div>
          )}
          {result.final && !result.confirmed && (
            <div className="mt-4 text-zinc-400 text-lg font-black uppercase tracking-[0.3em] animate-pulse">Decision pending…</div>
          )}
        </div>

        {/* Knockdowns + Warnings */}
        <div className="w-full grid grid-cols-2 gap-6 mb-8">
          <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 backdrop-blur-sm">
            <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Shield size={14} />
              Knockdowns — Round {Math.max(clock.round, 1)}
            </div>
            <div className="flex gap-4">
              <div className="flex-1 h-16 bg-red-900/30 border border-red-800/40 rounded-xl flex items-center justify-between px-5">
                <span className="text-red-400 font-bold text-sm tracking-wider uppercase">Red</span>
                <span className="text-white font-black text-3xl">{corners.Red.knockdowns_round}</span>
              </div>
              <div className="flex-1 h-16 bg-blue-900/30 border border-blue-800/40 rounded-xl flex items-center justify-between px-5">
                <span className="text-blue-400 font-bold text-sm tracking-wider uppercase">Blue</span>
                <span className="text-white font-black text-3xl">{corners.Blue.knockdowns_round}</span>
              </div>
            </div>
            {alertCorner && !result.final && corners[alertCorner].knockdowns_round > 0 && (
              <div className="mt-3 text-xs text-yellow-400 font-bold animate-pulse text-center">
                ⚠ {alertCorner.toUpperCase()}: {corners[alertCorner].knockdowns_round} knockdowns this round, {corners[alertCorner].knockdowns_fight} in the fight
              </div>
            )}
          </div>

          <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 backdrop-blur-sm">
            <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <AlertTriangle size={14} />
              Official Warnings
            </div>
            <div className="flex gap-4">
              <div className="flex-1 h-16 bg-red-900/30 border border-red-800/40 rounded-xl flex items-center justify-between px-5">
                <span className="text-red-400 font-bold text-sm tracking-wider uppercase">Red</span>
                <span className="text-white font-black text-3xl">{corners.Red.warnings}</span>
              </div>
              <div className="flex-1 h-16 bg-blue-900/30 border border-blue-800/40 rounded-xl flex items-center justify-between px-5">
                <span className="text-blue-400 font-bold text-sm tracking-wider uppercase">Blue</span>
                <span className="text-white font-black text-3xl">{corners.Blue.warnings}</span>
              </div>
            </div>
            {penalties.length > 0 && (
              <div className="mt-4 text-base font-black tracking-wide text-center uppercase flex justify-center gap-4">
                {penalties.map(p => <span key={p.key} className={p.className}>{p.text}</span>)}
              </div>
            )}
          </div>
        </div>

        {/* Per-Judge Scorecards */}
        {showScores && (
          <div className="w-full space-y-4">
            <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">
              Judge Scorecards
            </div>

            {view.judges.map((judge) => {
              const diff = judge.total.red - judge.total.blue;
              // After a stoppage judges have no verdict; don't keep showing who led.
              const pick = judge.verdict || (result.final ? '' : judge.leader);
              return (
                <div key={judge.seat} className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 backdrop-blur-sm">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-20 text-center flex-shrink-0">
                      <div className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Judge</div>
                      <div className="text-white text-2xl font-black">{judge.seat}</div>
                    </div>

                    <div className="flex-1 bg-gradient-to-r from-red-950/60 to-transparent rounded-xl py-3 px-5 flex items-center justify-between border border-red-900/30">
                      <span className="text-red-500 font-bold text-sm tracking-wider uppercase">Red</span>
                      <span className="text-white text-4xl font-black">{judge.total.red}</span>
                    </div>

                    <div className="text-zinc-700 font-bold text-lg">vs</div>

                    <div className="flex-1 bg-gradient-to-l from-blue-950/60 to-transparent rounded-xl py-3 px-5 flex items-center justify-between border border-blue-900/30">
                      <span className="text-white text-4xl font-black">{judge.total.blue}</span>
                      <span className="text-blue-500 font-bold text-sm tracking-wider uppercase">Blue</span>
                    </div>

                    <div className="w-20 text-center flex-shrink-0">
                      <div className="text-zinc-600 text-[10px] font-bold uppercase tracking-widest mb-1">
                        {judge.verdict ? 'Verdict' : result.final ? '' : 'Leading'}
                      </div>
                      <div className={`text-lg font-black ${winnerTextColor(pick)}`}>
                        {judge.decision_needed ? '…' : pick || '—'}
                      </div>
                    </div>
                  </div>

                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-red-400/70 font-bold uppercase">Red</span>
                      <span className="text-[10px] text-zinc-500 font-bold">
                        {diff === 0 ? 'EVEN' : `${Math.abs(diff)} ${diff > 0 ? 'RED' : 'BLUE'}`}
                      </span>
                      <span className="text-[10px] text-blue-400/70 font-bold uppercase">Blue</span>
                    </div>
                    <ScoreDiffBar diff={diff} size="lg" />
                  </div>

                  <div className="flex gap-2 mt-3">
                    {judge.rounds.map((r, idx) => (
                      <div key={idx} className="flex-1 bg-zinc-800/40 rounded-lg px-3 py-2 text-center">
                        <div className="text-[9px] text-zinc-600 font-bold uppercase tracking-wider mb-1">R{idx + 1}</div>
                        <div className="flex items-center justify-center gap-2 text-sm font-bold">
                          <span className="text-red-400">{r.red}</span>
                          <span className="text-zinc-700">:</span>
                          <span className="text-blue-400">{r.blue}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showWinner && (
          <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-8">
            <div className={`text-center p-12 rounded-3xl max-w-4xl w-full shadow-2xl border-2 animate-in zoom-in duration-500 ${resultBannerStyle(result.winner)}`}>
              <div className="text-xl font-bold mb-4 uppercase tracking-[0.4em] text-zinc-400/80">
                🏆 Match Winner 🏆
              </div>
              <div className={`text-7xl font-black uppercase tracking-wider ${winnerTextColor(result.winner)}`}>
                {cornerName(view, result.winner)}
              </div>
              <div className="text-zinc-300 text-2xl font-bold mt-8 uppercase tracking-[0.2em] bg-black/20 inline-block px-10 py-4 rounded-full border border-white/5 shadow-inner">
                {resultLabel(result)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
