import type { FightView } from './api/protocol';
import { addTimeSample, noteServerTime, resetTimeSamples } from './api/serverClock';

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
  format: FightFormat;
  fighters: TournamentFighter[];
}

/** A category's fight format (§2) and knockdown limits (§5). */
export interface FightFormat {
  rounds: number;
  round_seconds: number;
  rest_seconds: number;
  kd_limit_round: number;
  kd_limit_fight: number;
}

export const defaultFormat: FightFormat = {
  rounds: 3, round_seconds: 120, rest_seconds: 60, kd_limit_round: 3, kd_limit_fight: 4,
};

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

// Auto-detect WebSocket protocol:
//  - On HTTPS (production): use wss:// through nginx proxy at /ws (no port needed)
//  - On HTTP (local dev):   use ws:// directly to Go server on :8080
const isSecure = window.location.protocol === 'https:';
const SERVER_URL = isSecure
  ? `wss://${window.location.host}/ws`
  : `ws://${window.location.hostname}:8080/ws`;

let socket: WebSocket | null = null;
type StateCallback = (state: FightView) => void;
type TournamentCallback = (state: TournamentState) => void;
const listeners = new Set<StateCallback>();
const tournamentListeners = new Set<TournamentCallback>();

export function connectWebSocket() {
  if (socket) return;
  
  socket = new WebSocket(SERVER_URL);

  socket.onopen = () => {
    console.log('Connected to server');
    startTimeSync();
  };

  socket.onmessage = (event) => {
    try {
      // Handle batched messages separated by newlines
      const messages = event.data.split('\n');
      for (const msgString of messages) {
        if (!msgString) continue;
        const msg = JSON.parse(msgString);
        if (msg.server_time) noteServerTime(msg.server_time);
        if (msg.type === "TIME_SYNC") {
          addTimeSample(msg.payload.client_sent, msg.server_time);
        } else if (msg.type === "STATE_UPDATE") {
          const state = msg.payload as FightView;
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
    stopTimeSync();
    socket = null;
    setTimeout(connectWebSocket, 2000);
  };
}

// Clock sync: a burst of pings on connect, then one every 30 s.
let syncTimers: number[] = [];

function ping() {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'TIME_SYNC', payload: { client_sent: Date.now() } }));
  }
}

function startTimeSync() {
  stopTimeSync();
  resetTimeSamples();
  for (let i = 0; i < 5; i++) syncTimers.push(window.setTimeout(ping, i * 300));
  syncTimers.push(window.setInterval(ping, 30_000));
}

function stopTimeSync() {
  syncTimers.forEach(t => { clearTimeout(t); clearInterval(t); });
  syncTimers = [];
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

