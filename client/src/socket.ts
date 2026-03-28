
export type Fighter = 'Red' | 'Blue';

export interface Hit {
  id: string;
  fighter: Fighter;
  time: number;
  type: 'normal';
  timestamp: number;
}

export interface JudgeHitTracker {
  judge_id: string;
  hits: Hit[];
}

export interface OfficialWarning {
  id: string;
  fighter: Fighter;
  round: number;
  time: number;
}

export type RoundStatusType = 'ROUND_NOT_STARTED' | 'ROUND_RUNNING' | 'ROUND_PAUSED' | 'ROUND_ENDED';

export interface RoundState {
  round_id: number;
  status: RoundStatusType;
  start_time: number | null;
  end_time: number | null;
  elapsed_time: number;
  last_resume_time: number | null;
  judge_hits: Record<string, JudgeHitTracker>;
  knockdowns: Record<string, number>;
}

export interface MatchState {
  match_id: string;
  current_round: number;
  rounds: RoundState[];
  match_winner: Fighter | 'Draw' | null;
  match_result: string;
  official_warnings: Record<string, number>;
  warning_penalties: Record<string, number>;
  warning_history: OfficialWarning[];
  disqualified: Fighter | null;
  fight_ended: boolean;
  red_fighter_name: string;
  blue_fighter_name: string;
  category_name: string;
  rest_end_time: number | null;
  round_duration: number;
  rest_duration: number;
}

// ---- Tournament Types ----

export interface TournamentFighter {
  id: string;
  name: string;
  city: string;
  club: string;
  is_previous_champion: boolean;
  is_previous_second: boolean;
}

export interface WeightCategory {
  id: string;
  name: string;
  gender: string;
  sex: string;
  discipline: string;
  fighters: TournamentFighter[];
}

export type BracketMatchStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'BYE';

export interface BracketMatch {
  id: string;
  round: number;
  position: number;
  fighter_red_id: string;
  fighter_blue_id: string;
  fighter_red_name: string;
  fighter_blue_name: string;
  winner_id: string;
  status: BracketMatchStatus;
}

export interface Bracket {
  category_id: string;
  matches: BracketMatch[];
  total_rounds: number;
  generated: boolean;
}

export interface TournamentState {
  categories: WeightCategory[];
  brackets: Record<string, Bracket>;
  active_match_category_id: string;
  active_match_bracket_match_id: string;
}

// Global server IP / Address
// In a real environment, this would be a config or dynamic search parameter
const SERVER_URL = `ws://${window.location.hostname}:8080/ws`;

let socket: WebSocket | null = null;
type StateCallback = (state: MatchState) => void;
type TournamentCallback = (state: TournamentState) => void;
const listeners = new Set<StateCallback>();
const tournamentListeners = new Set<TournamentCallback>();

export function connectWebSocket() {
  if (socket) return;
  
  socket = new WebSocket(SERVER_URL);

  socket.onopen = () => {
    console.log('Connected to server');
  };

  socket.onmessage = (event) => {
    try {
      // Handle batched messages separated by newlines
      const messages = event.data.split('\n');
      for (const msgString of messages) {
        if (!msgString) continue;
        const msg = JSON.parse(msgString);
        if (msg.type === "STATE_UPDATE") {
          const state = msg.payload as MatchState;
          listeners.forEach(cb => cb(state));
        } else if (msg.type === "TOURNAMENT_STATE_UPDATE") {
          const state = msg.payload as TournamentState;
          tournamentListeners.forEach(cb => cb(state));
        }
      }
    } catch (e) {
      console.error('Failed to parse message', e);
    }
  };

  socket.onclose = () => {
    console.log('Disconnected. Reconnecting in 2s...');
    socket = null;
    setTimeout(connectWebSocket, 2000);
  };
}

export function subscribeToState(callback: StateCallback) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function subscribeToTournament(callback: TournamentCallback) {
  tournamentListeners.add(callback);
  return () => {
    tournamentListeners.delete(callback);
  };
}

export function sendAction(type: string, payload: unknown = {}) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, payload }));
  } else {
    console.warn("Socket not connected. Action dropped:", type);
  }
}

