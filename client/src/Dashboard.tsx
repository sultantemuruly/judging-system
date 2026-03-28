import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type MatchState, type TournamentState, sendAction } from './socket';
import { Play, Pause, Square, RotateCcw, AlertTriangle, Shield, Swords, Settings, X } from 'lucide-react';

interface Props {
  state: MatchState;
  tournament: TournamentState;
}

export default function Dashboard({ state, tournament }: Props) {
  const navigate = useNavigate();
  const currentRound = state.rounds[state.current_round - 1];

  const [displayTime, setDisplayTime] = useState("0:00");
  const [showNewFightConfirm, setShowNewFightConfirm] = useState(false);
  const [isRest, setIsRest] = useState(false);
  const [hideWinnerBanner, setHideWinnerBanner] = useState(false);
  
  // Auto-reset the close banner state when a new fight starts
  useEffect(() => {
    if (!state.fight_ended) {
      setHideWinnerBanner(false);
    }
  }, [state.fight_ended]);
  
  const [showSettings, setShowSettings] = useState(false);
  const [roundDurationInput, setRoundDurationInput] = useState(state.round_duration || 120);
  const [restDurationInput, setRestDurationInput] = useState(state.rest_duration || 60);

  useEffect(() => {
    setRoundDurationInput(state.round_duration || 120);
    setRestDurationInput(state.rest_duration || 60);
  }, [state.round_duration, state.rest_duration]);

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

      if (remainingTime === 0 && currentRound.status === 'ROUND_RUNNING') {
        sendAction("END_ROUND");
      }

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
    // Collect all judge IDs across all rounds
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
        // Tiebreak: R3 > R2 > R1
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

  const isRoundActive = currentRound.status === 'ROUND_RUNNING' || currentRound.status === 'ROUND_PAUSED';

  // Score difference bar component
  const ScoreDiffBar = ({ diff }: { diff: number }) => {
    const absDiff = Math.abs(diff);
    const isRed = diff > 0;
    const isBlue = diff < 0;

    return (
      <div className="flex items-center justify-center gap-0.5 min-h-[20px] w-full">
        {/* Left side (Red) */}
        <div className="flex-1 flex flex-wrap-reverse justify-end gap-1 pr-2">
          {isRed && Array.from({ length: absDiff }).map((_, i) => (
            <div
              key={`r-${i}`}
              className="w-4 h-5 rounded-sm bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]"
            />
          ))}
        </div>
        {/* Center divider */}
        <div className="w-px h-6 bg-zinc-600 flex-shrink-0" />
        {/* Right side (Blue) */}
        <div className="flex-1 flex flex-wrap justify-start gap-1 pl-2">
          {isBlue && Array.from({ length: absDiff }).map((_, i) => (
            <div
              key={`b-${i}`}
              className="w-4 h-5 rounded-sm bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.5)]"
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
        bannerStyle = 'bg-gradient-to-br from-zinc-700 to-zinc-900 border-zinc-500/50 shadow-[0_0_80px_rgba(161,161,170,0.15)]';
    } else if (isRedWinner) {
        bannerStyle = 'bg-gradient-to-br from-red-950/80 to-zinc-900 border-red-800/50 shadow-[0_0_80px_rgba(239,68,68,0.2)]';
    } else if (isBlueWinner) {
        bannerStyle = 'bg-gradient-to-br from-blue-950/80 to-zinc-900 border-blue-800/50 shadow-[0_0_80px_rgba(59,130,246,0.2)]';
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
    <div className="h-screen w-screen flex flex-col items-center bg-zinc-950 p-2 sm:p-4 overscroll-none overflow-hidden">
      
      {/* Header controls */}
      <div className="w-full max-w-6xl flex justify-between items-center mb-2 border-b border-zinc-800 pb-2 flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-black text-white tracking-widest uppercase">
            Kickboxing <span className="text-zinc-500 font-light">Judging</span>
          </h1>
          <button
            onClick={() => setShowSettings(true)}
            className="px-3 py-1.5 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold text-zinc-400 border border-zinc-700"
          >
            <Settings size={13} />
            Settings
          </button>
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
          {/* New Fight button */}
          <button
            className="px-4 py-2 bg-zinc-800 rounded-xl hover:bg-zinc-700 transition-all cursor-pointer flex items-center gap-2 text-sm font-bold text-zinc-300 border border-zinc-700"
            onClick={() => setShowNewFightConfirm(true)}
          >
            <RotateCcw size={16} />
            New Fight
          </button>

          <div className="w-px h-8 bg-zinc-800" />

          <button 
            disabled={currentRound.status === 'ROUND_RUNNING' || currentRound.status === 'ROUND_PAUSED' || state.fight_ended}
            className="p-3 bg-zinc-800 rounded-full hover:bg-zinc-700 disabled:opacity-30 transition-all cursor-pointer"
            onClick={() => sendAction("START_ROUND")}
          >
            <Play className="text-green-500" size={20} />
          </button>
          <button 
            disabled={currentRound.status !== 'ROUND_RUNNING'}
            className="p-3 bg-zinc-800 rounded-full hover:bg-zinc-700 disabled:opacity-30 transition-all cursor-pointer"
            onClick={() => sendAction("PAUSE_ROUND")}
          >
            <Pause className="text-yellow-500" size={20} />
          </button>
          <button 
            disabled={currentRound.status !== 'ROUND_PAUSED'}
            className="p-3 bg-zinc-800 rounded-full hover:bg-zinc-700 disabled:opacity-30 transition-all cursor-pointer"
            onClick={() => sendAction("RESUME_ROUND")}
          >
            <Play className="text-blue-500" size={20} />
          </button>
          <button 
            disabled={currentRound.status === 'ROUND_ENDED' || currentRound.status === 'ROUND_NOT_STARTED'}
            className="p-3 bg-zinc-800 rounded-full hover:bg-zinc-700 disabled:opacity-30 transition-all cursor-pointer"
            onClick={() => sendAction("END_ROUND")}
          >
            <Square className="text-red-500" size={20} />
          </button>
        </div>
      </div>

      {/* New Fight Confirmation Dialog */}
      {showNewFightConfirm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
            <h2 className="text-xl font-black text-white mb-3">Start New Fight?</h2>
            <p className="text-zinc-400 mb-6">This will reset all scores, warnings, and knockdowns. This action cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button
                className="px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl font-bold hover:bg-zinc-700 transition-all cursor-pointer"
                onClick={() => setShowNewFightConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="px-5 py-2.5 bg-red-600 text-white rounded-xl font-bold hover:bg-red-500 transition-all cursor-pointer"
                onClick={() => {
                  sendAction("NEW_FIGHT");
                  setShowSettings(false);
                  setShowNewFightConfirm(false);
                }}
              >
                Reset & Start New Fight
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Dialog */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-sm w-full shadow-2xl">
            <h2 className="text-xl font-black text-white mb-6 flex items-center gap-2">
              <Settings size={20} className="text-zinc-400" /> Match Settings
            </h2>
            
            <div className="space-y-4 mb-8">
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Round Duration</label>
                <select
                  value={roundDurationInput}
                  onChange={(e) => setRoundDurationInput(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-lg px-4 py-2.5 outline-none focus:border-emerald-500 transition-colors"
                >
                  <option value={60}>1 Minute (60s)</option>
                  <option value={90}>1.5 Minutes (90s)</option>
                  <option value={120}>2 Minutes (120s)</option>
                  <option value={150}>2.5 Minutes (150s)</option>
                  <option value={180}>3 Minutes (180s)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Rest Duration</label>
                <select
                  value={restDurationInput}
                  onChange={(e) => setRestDurationInput(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-lg px-4 py-2.5 outline-none focus:border-emerald-500 transition-colors"
                >
                  <option value={30}>30 Seconds</option>
                  <option value={45}>45 Seconds</option>
                  <option value={60}>1 Minute (60s)</option>
                  <option value={90}>1.5 Minutes (90s)</option>
                  <option value={120}>2 Minutes (120s)</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                className="px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl font-bold hover:bg-zinc-700 transition-all cursor-pointer"
                onClick={() => setShowSettings(false)}
              >
                Cancel
              </button>
              <button
                className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-500 transition-all cursor-pointer"
                onClick={() => {
                  sendAction("UPDATE_MATCH_SETTINGS", { round_duration: roundDurationInput, rest_duration: restDurationInput });
                  setShowSettings(false);
                }}
              >
                Save Limits
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main scoreboard */}
      <div className="flex-1 w-full max-w-6xl flex flex-col min-h-0 justify-between">
        
        {/* Timer + Round */}
        <div className="text-center mb-2 flex-shrink-0 mt-1">
          {/* Fighter Names + Category */}
          {(state.red_fighter_name || state.blue_fighter_name) && (
            <div className="mb-1">
              {state.category_name && (
                <div className="text-zinc-400 text-sm md:text-base font-black uppercase tracking-[0.2em] mb-1">{state.category_name}</div>
              )}
              <div className="flex items-center justify-center gap-6">
                <div className="text-right flex-1">
                  <div className="text-red-500 text-4xl md:text-5xl font-black uppercase tracking-tight leading-none">{state.red_fighter_name || 'RED'}</div>
                </div>
                <div className="text-zinc-600 font-black text-2xl flex-shrink-0">VS</div>
                <div className="text-left flex-1">
                  <div className="text-blue-500 text-4xl md:text-5xl font-black uppercase tracking-tight leading-none">{state.blue_fighter_name || 'BLUE'}</div>
                </div>
              </div>
            </div>
          )}
          <div className="flex items-end justify-center gap-4 mt-2">
             <div className="text-zinc-400 text-lg md:text-xl uppercase tracking-widest font-black pb-2 text-right w-24">R{state.current_round}</div>
             <div className="text-7xl md:text-8xl font-black text-white font-mono tracking-tighter leading-none">
               {displayTime}
             </div>
             <div className={`text-sm md:text-base font-black pb-2 uppercase w-24 text-left ${isRest ? 'text-cyan-400 animate-pulse' : 'text-zinc-500'}`}>
               {isRest ? 'REST PHASE' : currentRound.status.replace('ROUND_', '')}
             </div>
          </div>
        </div>

        {/* Referee Controls: Knockdowns + Warnings */}
        <div className="w-full grid grid-cols-2 gap-3 mb-3 flex-shrink-0">
          
          {/* Knockdowns */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 px-3">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 flex items-center gap-2">
              <Shield size={12} />
              Knockdowns
            </div>
            <div className="flex gap-2">
              <button
                disabled={!isRoundActive || state.fight_ended}
                onClick={() => sendAction("KNOCKDOWN", { fighter: "Red" })}
                className="flex-1 h-10 bg-red-900/40 border border-red-800/50 rounded-lg flex items-center justify-between px-3 hover:bg-red-900/60 disabled:opacity-30 transition-all cursor-pointer"
              >
                <span className="text-red-400 font-bold text-xs">RED KD</span>
                <span className="text-white font-black text-xl leading-none pt-0.5">{redKD}</span>
              </button>
              <button
                disabled={!isRoundActive || state.fight_ended}
                onClick={() => sendAction("KNOCKDOWN", { fighter: "Blue" })}
                className="flex-1 h-10 bg-blue-900/40 border border-blue-800/50 rounded-lg flex items-center justify-between px-3 hover:bg-blue-900/60 disabled:opacity-30 transition-all cursor-pointer"
              >
                <span className="text-blue-400 font-bold text-xs">BLUE KD</span>
                <span className="text-white font-black text-xl leading-none pt-0.5">{blueKD}</span>
              </button>
            </div>
            {(redKD >= 2 || blueKD >= 2) && (
              <div className="mt-1 text-[10px] text-yellow-400 font-bold animate-pulse leading-none">
                ⚠ {redKD >= 2 ? 'RED' : 'BLUE'} has {Math.max(redKD, blueKD)} knockdowns — 3 = TKO!
              </div>
            )}
          </div>

          {/* Official Warnings */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 px-3">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 flex items-center gap-2">
              <AlertTriangle size={12} />
              Official Warnings
            </div>
            <div className="flex gap-2">
              <button
                disabled={state.fight_ended}
                onClick={() => sendAction("OFFICIAL_WARNING", { fighter: "Red" })}
                className="flex-1 h-10 bg-red-900/40 border border-red-800/50 rounded-lg flex items-center justify-between px-3 hover:bg-red-900/60 disabled:opacity-30 transition-all cursor-pointer"
              >
                <span className="text-red-400 font-bold text-xs">RED</span>
                <span className="text-white font-black text-xl leading-none pt-0.5">{redWarnings}</span>
              </button>
              <button
                disabled={state.fight_ended}
                onClick={() => sendAction("OFFICIAL_WARNING", { fighter: "Blue" })}
                className="flex-1 h-10 bg-blue-900/40 border border-blue-800/50 rounded-lg flex items-center justify-between px-3 hover:bg-blue-900/60 disabled:opacity-30 transition-all cursor-pointer"
              >
                <span className="text-blue-400 font-bold text-xs">BLUE</span>
                <span className="text-white font-black text-xl leading-none pt-0.5">{blueWarnings}</span>
              </button>
            </div>
            {(redWarnings >= 1 || blueWarnings >= 1) && (
              <div className="mt-1.5 text-xs font-bold text-zinc-300 leading-tight">
                {[redWarnings > 0 && <span key="red" className="text-red-400">Red: {redWarnings}{redWarnings >= 2 ? ` (−${(Math.min(redWarnings, 3) - 1) * 3} pts)` : ''}{redWarnings >= 4 ? ' → DQ!' : ''}</span>,
                  blueWarnings > 0 && <span key="blue" className="text-blue-400">Blue: {blueWarnings}{blueWarnings >= 2 ? ` (−${(Math.min(blueWarnings, 3) - 1) * 3} pts)` : ''}{blueWarnings >= 4 ? ' → DQ!' : ''}</span>
                ].filter(Boolean).reduce((prev, curr) => [prev, <span key="sep" className="text-zinc-600 mx-1">·</span>, curr] as any)}
              </div>
            )}
          </div>
        </div>

        {/* Per-Judge Scorecards with Difference Bar */}
        <div className="w-full flex-1 min-h-0 flex flex-col justify-end gap-2 pb-2">
          {perJudge.length === 0 && (
            <div className="text-center text-zinc-600 text-lg py-8">No judge scores yet</div>
          )}
          {perJudge.map((judge) => {
            const diff = judge.totalRed - judge.totalBlue; // positive = red leads
            return (
              <div key={judge.id} className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 px-4 flex items-center gap-4 shadow-sm">
                
                {/* Judge info */}
                <div className="w-20 text-center flex-shrink-0 border-r border-zinc-800 pr-4">
                  <div className="text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5">
                    JUDGE <span className="text-zinc-500 text-base">{judge.id.replace(/judge\s*/i, '')}</span>
                  </div>
                </div>

                {/* Red Score */}
                <div className="w-16 text-center flex-shrink-0">
                  <div className="text-red-500 text-[10px] font-bold uppercase tracking-widest mb-0.5">Red</div>
                  <div className="text-white text-4xl font-black leading-none">{judge.totalRed}</div>
                </div>

                {/* Score Difference Bar (Center) */}
                <div className="flex-1 flex flex-col justify-center bg-zinc-950/40 rounded-lg px-3 py-1.5 border border-zinc-800/50">
                  <div className="flex items-center justify-center mb-1">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                      {diff === 0 ? 'EVEN' : `DIFF: ${Math.abs(diff)}`}
                    </span>
                  </div>
                  <ScoreDiffBar diff={diff} />
                </div>

                {/* Blue Score */}
                <div className="w-16 text-center flex-shrink-0">
                  <div className="text-blue-500 text-[10px] font-bold uppercase tracking-widest mb-0.5">Blue</div>
                  <div className="text-white text-4xl font-black leading-none">{judge.totalBlue}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Match Winner / TKO / DQ Announcement */}
        {state.fight_ended && state.match_winner && !hideWinnerBanner && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4">
          <div className={`relative text-center p-12 rounded-3xl max-w-3xl mx-auto w-full shadow-2xl border-2 animate-in zoom-in duration-300 ${bannerStyle}`}>
            {/* Close Button */}
            <button 
              onClick={() => setHideWinnerBanner(true)}
              className="absolute top-6 right-6 text-zinc-500 hover:text-white transition-colors cursor-pointer bg-black/20 p-2 rounded-full hover:bg-black/40"
              title="Close Banner"
            >
              <X size={24} />
            </button>
            <div className={`text-lg font-bold mb-3 uppercase tracking-[0.3em] ${
              state.match_winner === 'Red' ? 'text-red-400/80' : 
              state.match_winner === 'Blue' ? 'text-blue-400/80' : 
              'text-zinc-400/80'
            }`}>
              🏆 Match Winner 🏆
            </div>
            <div className={`text-6xl md:text-7xl font-black uppercase tracking-tight ${
              state.match_winner === 'Red' ? 'text-red-500' : 
              state.match_winner === 'Blue' ? 'text-blue-500' : 
              'text-zinc-300'
            }`}>
              {state.match_winner === 'Red' ? (state.red_fighter_name || 'Red Corner') : 
               state.match_winner === 'Blue' ? (state.blue_fighter_name || 'Blue Corner') : 
               'Draw'}
            </div>
            {descriptiveReason && (
              <div className="text-zinc-300 text-xl font-bold mt-6 uppercase tracking-[0.2em] bg-black/20 inline-block px-8 py-3 rounded-full border border-white/5 shadow-inner">
                {descriptiveReason}
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
