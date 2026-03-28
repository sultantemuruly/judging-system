import { useParams } from 'react-router-dom';
import { type MatchState, sendAction } from './socket';

interface Props {
  state: MatchState;
}

export default function JudgeScreen({ state }: Props) {
  const { id } = useParams<{ id: string }>();
  // Default to judge "1" if invalid
  const judgeId = id || "1";

  const currentRound = state.rounds[state.current_round - 1];

  const handleHit = (fighter: 'Red' | 'Blue') => {
    if (!isEnabled) return;
    // Vibrate for feedback if supported
    if ('vibrate' in navigator) navigator.vibrate(50);
    
    sendAction("REGISTER_HIT", {
      judge_id: judgeId,
      hit: {
        fighter,
        type: 'normal',
      }
    });
  };

  const isEnabled = currentRound?.status === 'ROUND_RUNNING' && !state.fight_ended;

  return (
    <div className="h-screen w-full flex flex-col bg-zinc-950 overflow-hidden select-none">
      
      {/* Top Bar */}
      <div className="h-16 flex items-center justify-between px-6 bg-zinc-900 shadow-md z-10 border-b border-zinc-800">
        <div className="text-lg font-black tracking-widest text-zinc-400 uppercase">
          JUDGE <span className="text-white ml-2">{judgeId}</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-sm font-bold text-zinc-500 tracking-widest uppercase">
            ROUND <span className="text-white ml-1">{state.current_round}</span>
          </div>
          <div className="px-3 py-1 bg-zinc-800 rounded-full text-xs font-bold text-zinc-300">
            {currentRound?.status.replace('ROUND_', '')}
          </div>
        </div>
      </div>

      {/* Fight ended overlay */}
      {state.fight_ended && (
        <div className="absolute inset-0 z-50 bg-zinc-950/90 flex flex-col items-center justify-center">
          <div className="text-zinc-400 text-xl font-bold uppercase tracking-widest mb-4">Fight Over</div>
          <div className={`text-5xl font-black uppercase ${
            state.match_winner === 'Red' ? 'text-red-500' : 
            state.match_winner === 'Blue' ? 'text-blue-500' : 
            'text-zinc-300'
          }`}>
            {state.match_winner} {state.match_result ? `(${state.match_result})` : ''}
          </div>
        </div>
      )}

      {/* Main Buttons */}
      <div className="flex-1 flex w-full relative">
        
        {/* Red Button */}
        <button 
          disabled={!isEnabled}
          onPointerDown={() => handleHit('Red')}
          className="flex-1 bg-gradient-to-b from-red-600 to-red-700 disabled:opacity-50 disabled:grayscale transition-transform btn-active-scale flex flex-col items-center justify-center relative shadow-[inset_0_4px_30px_rgba(255,255,255,0.2)] active:shadow-[inset_0_10px_50px_rgba(0,0,0,0.4)] touch-manipulation cursor-pointer"
        >
          {state.red_fighter_name && (
            <div className="text-white/70 text-lg font-bold tracking-wider mb-1 drop-shadow-md">{state.red_fighter_name}</div>
          )}
          <div className="text-white font-black text-6xl tracking-widest drop-shadow-md opacity-80">RED</div>
        </button>

        {/* Separator / Decoration */}
        <div className="w-1.5 h-full bg-zinc-950 z-20"></div>

        {/* Blue Button */}
        <button 
          disabled={!isEnabled}
          onPointerDown={() => handleHit('Blue')}
          className="flex-1 bg-gradient-to-b from-blue-600 to-blue-700 disabled:opacity-50 disabled:grayscale transition-transform btn-active-scale flex flex-col items-center justify-center relative shadow-[inset_0_4px_30px_rgba(255,255,255,0.2)] active:shadow-[inset_0_10px_50px_rgba(0,0,0,0.4)] touch-manipulation cursor-pointer"
        >
          {state.blue_fighter_name && (
            <div className="text-white/70 text-lg font-bold tracking-wider mb-1 drop-shadow-md">{state.blue_fighter_name}</div>
          )}
           <div className="text-white font-black text-6xl tracking-widest drop-shadow-md opacity-80">BLUE</div>
        </button>

      </div>

    </div>
  );
}
