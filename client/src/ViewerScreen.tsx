import { useEffect, useState } from 'react';
import { type MatchState } from './socket';
import { AlertTriangle, Shield, Eye } from 'lucide-react';

interface Props {
  state: MatchState;
}

export default function ViewerScreen({ state }: Props) {
  const currentRound = state.rounds[state.current_round - 1];

  // Local timer state for smooth updates
  const [displayTime, setDisplayTime] = useState("0:00");
  const [isRest, setIsRest] = useState(false);

  useEffect(() => {
    if (!currentRound) return;

    let interval: number;

    const updateTimer = () => {
      if (state.rest_end_time && currentRound.status === 'ROUND_ENDED') {
        const remainingRest = Math.max(0, state.rest_end_time - Date.now());
        const seconds = Math.floor(remainingRest / 1000);
        const minutes = Math.floor(seconds / 60);
        const remSecs = seconds % 60;
        setDisplayTime(`${minutes}:${remSecs.toString().padStart(2, '0')}`);
        setIsRest(true);
        return;
      }

      setIsRest(false);
      let elapsed = currentRound.elapsed_time;
      if (currentRound.status === 'ROUND_RUNNING' && currentRound.last_resume_time != null) {
        elapsed += Date.now() - currentRound.last_resume_time;
      }

      // Configured customized countdown
      const MAX_DURATION = (state.round_duration || 120) * 1000;
      const remainingTime = Math.max(0, MAX_DURATION - elapsed);

      const seconds = Math.floor(remainingTime / 1000);
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      setDisplayTime(`${minutes}:${remainingSeconds.toString().padStart(2, '0')}`);
    };

    updateTimer();

    if (currentRound.status === 'ROUND_RUNNING' || (state.rest_end_time && currentRound.status === 'ROUND_ENDED')) {
      interval = window.setInterval(updateTimer, 100);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentRound?.status, currentRound?.elapsed_time, currentRound?.last_resume_time, state.rest_end_time]);

  if (!currentRound) return null;

  // Compute per-judge CUMULATIVE scores across ALL rounds
  const computePerJudgeScores = () => {
    const judgeIds = new Set<string>();
    state.rounds.forEach(round => {
      Object.keys(round.judge_hits).forEach(jid => judgeIds.add(jid));
    });

    const judges: { id: string; totalRed: number; totalBlue: number; perRound: { red: number; blue: number }[]; winner: string }[] = [];

    judgeIds.forEach(judgeId => {
      let totalRed = 0;
      let totalBlue = 0;
      const perRound: { red: number; blue: number }[] = [];

      state.rounds.forEach(round => {
        let roundRed = 0;
        let roundBlue = 0;
        const tracker = round.judge_hits[judgeId];
        if (tracker) {
          tracker.hits.forEach(h => {
            if (h.fighter === 'Red') roundRed += 1;
            if (h.fighter === 'Blue') roundBlue += 1;
          });
        }
        perRound.push({ red: roundRed, blue: roundBlue });
        totalRed += roundRed;
        totalBlue += roundBlue;
      });

      // Subtract warning penalties
      const penaltyRed = state.warning_penalties?.Red || 0;
      const penaltyBlue = state.warning_penalties?.Blue || 0;
      totalRed = totalRed - penaltyRed;
      totalBlue = totalBlue - penaltyBlue;

      // Determine this judge's winner with tiebreak
      let winner = 'Draw';
      if (totalRed > totalBlue) {
        winner = 'Red';
      } else if (totalBlue > totalRed) {
        winner = 'Blue';
      } else {
        for (let i = perRound.length - 1; i >= 0; i--) {
          if (perRound[i].red > perRound[i].blue) {
            winner = 'Red';
            break;
          } else if (perRound[i].blue > perRound[i].red) {
            winner = 'Blue';
            break;
          }
        }
      }

      judges.push({ id: judgeId, totalRed, totalBlue, perRound, winner });
    });

    return judges;
  };

  const perJudge = computePerJudgeScores();

  const redWarnings = state.official_warnings?.Red || 0;
  const blueWarnings = state.official_warnings?.Blue || 0;
  const redKD = currentRound.knockdowns?.Red || 0;
  const blueKD = currentRound.knockdowns?.Blue || 0;

  // Determine round status styling
  const statusColor =
    isRest ? 'text-cyan-400' :
    currentRound.status === 'ROUND_RUNNING' ? 'text-green-400' :
    currentRound.status === 'ROUND_PAUSED' ? 'text-yellow-400' :
    currentRound.status === 'ROUND_ENDED' ? 'text-red-400' :
    'text-zinc-500';

  const statusPulse = (currentRound.status === 'ROUND_RUNNING' || isRest) ? 'animate-pulse' : '';

  // Score difference bar component — larger for viewer
  const ScoreDiffBar = ({ diff }: { diff: number }) => {
    const absDiff = Math.abs(diff);
    const isRed = diff > 0;
    const isBlue = diff < 0;

    return (
      <div className="flex items-center justify-center gap-1 min-h-[40px] w-full">
        {/* Left side (Red) */}
        <div className="flex-1 flex flex-wrap-reverse justify-end gap-1 pr-1">
          {isRed && Array.from({ length: absDiff }).map((_, i) => (
            <div
              key={`r-${i}`}
              className="w-6 h-8 rounded-sm bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.6)]"
              style={{ opacity: 0.5 + Math.min((i / absDiff) * 0.5, 0.5) }}
            />
          ))}
        </div>
        {/* Center divider */}
        <div className="w-0.5 h-10 bg-zinc-600 flex-shrink-0" />
        {/* Right side (Blue) */}
        <div className="flex-1 flex flex-wrap justify-start gap-1 pl-1">
          {isBlue && Array.from({ length: absDiff }).map((_, i) => (
            <div
              key={`b-${i}`}
              className="w-6 h-8 rounded-sm bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.6)]"
              style={{ opacity: 0.5 + Math.min((i / absDiff) * 0.5, 0.5) }}
            />
          ))}
        </div>
      </div>
    );
  };

  let bannerStyle = 'bg-gradient-to-br from-zinc-800 to-zinc-900 border-zinc-600/50';
  let descriptiveReason = '';

  if (state.fight_ended && state.match_winner) {
    const isRedWinner = state.match_winner === 'Red';
    const isBlueWinner = state.match_winner === 'Blue';
    
    if (state.match_result === 'DRAW' || state.match_winner === 'Draw') {
        bannerStyle = 'bg-gradient-to-br from-zinc-700/50 to-zinc-900 border-zinc-500/50 shadow-[0_0_100px_rgba(161,161,170,0.15)]';
    } else if (isRedWinner) {
        bannerStyle = 'bg-gradient-to-br from-red-950/80 to-zinc-900 border-red-800/50 shadow-[0_0_100px_rgba(239,68,68,0.2)]';
    } else if (isBlueWinner) {
        bannerStyle = 'bg-gradient-to-br from-blue-950/80 to-zinc-900 border-blue-800/50 shadow-[0_0_100px_rgba(59,130,246,0.2)]';
    }

    if (state.match_result === 'DQ') {
       descriptiveReason = isRedWinner ? 'BLUE DISQUALIFIED' : 'RED DISQUALIFIED';
    } else if (state.match_result === 'TKO') {
       descriptiveReason = 'WIN BY TECHNICAL KNOCKOUT (TKO)';
    } else if (state.match_result === 'KO') {
       descriptiveReason = 'WIN BY KNOCKOUT (KO)';
    } else if (state.match_result === 'DECISION' || !state.match_result) {
       descriptiveReason = state.match_winner === 'Draw' ? 'DRAW BY POINTS' : 'WIN BY POINTS';
    } else {
       descriptiveReason = `WIN BY ${state.match_result}`;
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center bg-zinc-950 p-6 overscroll-none">

      {/* Header */}
      <div className="w-full max-w-7xl flex justify-between items-center mb-8 border-b border-zinc-800 pb-4">
        <h1 className="text-3xl font-black text-white tracking-widest uppercase">
          Low Kick <span className="text-zinc-500 font-light">Live</span>
        </h1>
        <div className="flex items-center gap-3 text-zinc-500">
          <Eye size={20} />
          <span className="text-sm font-bold uppercase tracking-widest">Spectator View</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 w-full max-w-7xl flex flex-col">

        {/* Fighter Names + Category */}
        {(state.red_fighter_name || state.blue_fighter_name) && (
          <div className="text-center mb-6">
            {state.category_name && (
              <div className="text-zinc-500 text-xs font-bold uppercase tracking-[0.25em] mb-3">{state.category_name}</div>
            )}
            <div className="flex items-center justify-center gap-8">
              <div className="text-right">
                <div className="text-red-500 text-3xl font-black uppercase drop-shadow-[0_0_20px_rgba(239,68,68,0.3)]">
                  {state.red_fighter_name || 'RED'}
                </div>
              </div>
              <div className="text-zinc-600 font-bold text-xl">VS</div>
              <div className="text-left">
                <div className="text-blue-500 text-3xl font-black uppercase drop-shadow-[0_0_20px_rgba(59,130,246,0.3)]">
                  {state.blue_fighter_name || 'BLUE'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Timer + Round — Big & Cinematic */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-4 mb-2">
            <div className="h-px flex-1 max-w-32 bg-gradient-to-r from-transparent to-zinc-700" />
            <h2 className="text-zinc-400 text-xl uppercase tracking-[0.3em] font-semibold">
              Round {state.current_round}
            </h2>
            <div className="h-px flex-1 max-w-32 bg-gradient-to-l from-transparent to-zinc-700" />
          </div>
          <div className="text-9xl font-black text-white font-mono tracking-tighter drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]">
            {displayTime}
          </div>
          <div className={`mt-2 text-sm font-bold uppercase tracking-widest ${statusColor} ${statusPulse}`}>
            {currentRound.status === 'ROUND_RUNNING' && '● '} 
            {isRest ? 'REST PHASE' : currentRound.status.replace('ROUND_', '')}
          </div>
        </div>

        {/* Stats Row: Knockdowns + Warnings */}
        <div className="w-full grid grid-cols-2 gap-6 mb-8">

          {/* Knockdowns */}
          <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 backdrop-blur-sm">
            <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Shield size={14} />
              Knockdowns — Round {state.current_round}
            </div>
            <div className="flex gap-4">
              <div className="flex-1 h-16 bg-red-900/30 border border-red-800/40 rounded-xl flex items-center justify-between px-5">
                <span className="text-red-400 font-bold text-sm tracking-wider uppercase">Red</span>
                <span className="text-white font-black text-3xl">{redKD}</span>
              </div>
              <div className="flex-1 h-16 bg-blue-900/30 border border-blue-800/40 rounded-xl flex items-center justify-between px-5">
                <span className="text-blue-400 font-bold text-sm tracking-wider uppercase">Blue</span>
                <span className="text-white font-black text-3xl">{blueKD}</span>
              </div>
            </div>
            {(redKD >= 2 || blueKD >= 2) && (
              <div className="mt-3 text-xs text-yellow-400 font-bold animate-pulse text-center">
                ⚠ {redKD >= 2 ? 'RED' : 'BLUE'} has {Math.max(redKD, blueKD)} knockdowns — 3 = TKO!
              </div>
            )}
          </div>

          {/* Official Warnings */}
          <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 backdrop-blur-sm">
            <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <AlertTriangle size={14} />
              Official Warnings
            </div>
            <div className="flex gap-4">
              <div className="flex-1 h-16 bg-red-900/30 border border-red-800/40 rounded-xl flex items-center justify-between px-5">
                <span className="text-red-400 font-bold text-sm tracking-wider uppercase">Red</span>
                <span className="text-white font-black text-3xl">{redWarnings}</span>
              </div>
              <div className="flex-1 h-16 bg-blue-900/30 border border-blue-800/40 rounded-xl flex items-center justify-between px-5">
                <span className="text-blue-400 font-bold text-sm tracking-wider uppercase">Blue</span>
                <span className="text-white font-black text-3xl">{blueWarnings}</span>
              </div>
            </div>
            {(redWarnings >= 1 || blueWarnings >= 1) && (
              <div className="mt-4 text-base font-black text-zinc-300 tracking-wide text-center uppercase">
                {[redWarnings > 0 && <span key="red" className="text-red-400 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]">Red: {redWarnings}{redWarnings >= 2 ? ` (−${(Math.min(redWarnings, 3) - 1) * 3} pts)` : ''}{redWarnings >= 4 ? ' → DQ!' : ''}</span>,
                  blueWarnings > 0 && <span key="blue" className="text-blue-400 drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]">Blue: {blueWarnings}{blueWarnings >= 2 ? ` (−${(Math.min(blueWarnings, 3) - 1) * 3} pts)` : ''}{blueWarnings >= 4 ? ' → DQ!' : ''}</span>
                ].filter(Boolean).reduce((prev, curr) => [prev, <span key="sep" className="text-zinc-600 mx-2">·</span>, curr] as any)}
              </div>
            )}
          </div>
        </div>

        {/* Per-Judge Scorecards */}
        <div className="w-full space-y-4">
          <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">
            Judge Scorecards
          </div>

          {perJudge.length === 0 && (
            <div className="text-center text-zinc-600 text-lg py-12 bg-zinc-900/40 rounded-2xl border border-zinc-800/50">
              Waiting for judge scores…
            </div>
          )}

          {perJudge.map((judge) => {
            const diff = judge.totalRed - judge.totalBlue;
            return (
              <div key={judge.id} className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 backdrop-blur-sm">

                {/* Judge label + scores */}
                <div className="flex items-center gap-4 mb-4">
                  {/* Judge label */}
                  <div className="w-20 text-center flex-shrink-0">
                    <div className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Judge</div>
                    <div className="text-white text-2xl font-black">{judge.id}</div>
                  </div>

                  {/* Red score */}
                  <div className="flex-1 bg-gradient-to-r from-red-950/60 to-transparent rounded-xl py-3 px-5 flex items-center justify-between border border-red-900/30">
                    <span className="text-red-500 font-bold text-sm tracking-wider uppercase">Red</span>
                    <span className="text-white text-4xl font-black">{judge.totalRed}</span>
                  </div>

                  <div className="text-zinc-700 font-bold text-lg">vs</div>

                  {/* Blue score */}
                  <div className="flex-1 bg-gradient-to-l from-blue-950/60 to-transparent rounded-xl py-3 px-5 flex items-center justify-between border border-blue-900/30">
                    <span className="text-white text-4xl font-black">{judge.totalBlue}</span>
                    <span className="text-blue-500 font-bold text-sm tracking-wider uppercase">Blue</span>
                  </div>

                  {/* Judge's pick */}
                  <div className="w-20 text-center flex-shrink-0">
                    <div className="text-zinc-600 text-[10px] font-bold uppercase tracking-widest mb-1">Verdict</div>
                    <div className={`text-lg font-black ${
                      judge.winner === 'Red' ? 'text-red-500' :
                      judge.winner === 'Blue' ? 'text-blue-500' :
                      'text-zinc-500'
                    }`}>
                      {judge.winner === 'Draw' ? '—' : judge.winner}
                    </div>
                  </div>
                </div>

                {/* Score Difference Bar */}
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-red-400/70 font-bold uppercase">Red</span>
                    <span className="text-[10px] text-zinc-500 font-bold">
                      {diff === 0 ? 'EVEN' : `${Math.abs(diff)} ${diff > 0 ? 'RED' : 'BLUE'}`}
                    </span>
                    <span className="text-[10px] text-blue-400/70 font-bold uppercase">Blue</span>
                  </div>
                  <ScoreDiffBar diff={diff} />
                </div>

                {/* Per-round breakdown */}
                <div className="flex gap-2 mt-3">
                  {judge.perRound.map((r, idx) => (
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

        {/* Match Winner / TKO / DQ Announcement */}
        {state.fight_ended && state.match_winner && (
          <div className={`mt-10 text-center p-12 rounded-3xl max-w-4xl mx-auto w-full shadow-2xl border-2 animate-in zoom-in duration-500 ${bannerStyle}`}>
            <div className={`text-xl font-bold mb-4 uppercase tracking-[0.4em] ${
              state.match_winner === 'Red' ? 'text-red-400/80' : 
              state.match_winner === 'Blue' ? 'text-blue-400/80' : 
              'text-zinc-400/80'
            }`}>
              🏆 Match Winner 🏆
            </div>
            <div className={`text-7xl font-black uppercase tracking-wider ${
              state.match_winner === 'Red' ? 'text-red-500 drop-shadow-[0_0_40px_rgba(239,68,68,0.4)]' : 
              state.match_winner === 'Blue' ? 'text-blue-500 drop-shadow-[0_0_40px_rgba(59,130,246,0.4)]' : 
              'text-zinc-300'
            }`}>
              {state.match_winner === 'Red' ? (state.red_fighter_name || 'Red Corner') : 
               state.match_winner === 'Blue' ? (state.blue_fighter_name || 'Blue Corner') : 
               'Draw'}
            </div>
            {descriptiveReason && (
              <div className="text-zinc-300 text-2xl font-bold mt-8 uppercase tracking-[0.2em] bg-black/20 inline-block px-10 py-4 rounded-full border border-white/5 shadow-inner">
                {descriptiveReason}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
