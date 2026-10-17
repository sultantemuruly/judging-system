// Protocol types. They mirror the Go structs in server/internal/match (view.go,
// event.go, result.go); change both sides in the same commit.

export type Corner = 'Red' | 'Blue';
export type Method = 'PTS' | 'KO' | 'RSC' | 'DQ' | 'AB' | 'WO';
export type Phase = 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'REST' | 'ENDED';

export interface Score {
  red: number;
  blue: number;
}

export interface ClockView {
  phase: Phase;
  round: number;
  rounds: number;
  round_ms: number;
  rest_ms: number;
  elapsed_ms: number;
  running_since: number;
  round_ended_at: number;
  rest_ends_at: number;
  judge_undo_until: number;
}

export interface JudgeView {
  seat: number;
  connected: boolean;
  rounds: Score[];
  total: Score;
  hits: number;
  leader: Corner | '';
  verdict: Corner | '';
  decided: boolean;
  decision_needed: boolean;
  /** Taps the judge's device holds that the server hasn't confirmed yet. */
  pending: number;
}

export interface CornerView {
  warnings: number;
  minus_points: number;
  penalty: number;
  knockdowns_round: number;
  knockdowns_fight: number;
  knockdown_alert: boolean;
  knockdown_limit: boolean;
  next_warning_dq: boolean;
}

export type RefereeActionType = 'OfficialWarning' | 'MinusPoint' | 'Knockdown' | 'Stoppage';

export interface ActionView {
  id: string;
  type: RefereeActionType;
  corner: Corner;
  method?: Method;
  round: number;
  at: number;
  undone: boolean;
  warning_number?: number;
  deduction?: number;
  disqualifies?: boolean;
}

export interface MedicalView {
  active: boolean;
  started_at: number;
  ends_at: number;
}

export interface FightResult {
  winner: Corner | '';
  method: Method | '';
  votes?: string;
  final: boolean;
  confirmed: boolean;
}

export interface BracketRef {
  category_id: string;
  match_id: string;
}

export interface FightView {
  fight_id: string;
  red_name: string;
  blue_name: string;
  category: string;
  bracket: BracketRef | null;
  clock: ClockView;
  judges: JudgeView[];
  corners: Record<Corner, CornerView>;
  result: FightResult;
  actions: ActionView[];
  medical: MedicalView;
  /** How the operator may stop the fight right now (§5); empty when not allowed. */
  stoppage_methods: Method[];
  /** All judges connected with nothing unsent: the result can be confirmed (§7). */
  judges_synced: boolean;
  /** Confirmed, but not saved in the bracket yet: confirming again retries (§7). */
  result_not_recorded: boolean;
  live_scores: boolean;
}

const emptyCorner: CornerView = {
  warnings: 0, minus_points: 0, penalty: 0,
  knockdowns_round: 0, knockdowns_fight: 0, knockdown_alert: false, knockdown_limit: false, next_warning_dq: false,
};

export const emptyFight: FightView = {
  fight_id: '',
  red_name: '',
  blue_name: '',
  category: '',
  bracket: null,
  clock: {
    phase: 'NOT_STARTED', round: 0, rounds: 3, round_ms: 120_000, rest_ms: 60_000,
    elapsed_ms: 0, running_since: 0, round_ended_at: 0, rest_ends_at: 0, judge_undo_until: 0,
  },
  judges: [],
  corners: { Red: emptyCorner, Blue: emptyCorner },
  result: { winner: '', method: '', final: false, confirmed: false },
  actions: [],
  medical: { active: false, started_at: 0, ends_at: 0 },
  stoppage_methods: [],
  judges_synced: false,
  live_scores: true,
  result_not_recorded: false,
};

// ---- Tournament (mirrors server/internal/tournament/model.go) ----

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
  method?: Method;
  votes?: string;
  fight_id?: string;
  corrections?: Correction[];
}

export type CorrectionReason = 'corners_switched' | 'operator_error' | 'protest';

/** A result changed by the chief judge (§8); the old winner is kept. */
export interface Correction {
  at: number;
  old_winner_id: string;
  new_winner_id: string;
  reason: CorrectionReason;
}

/** 1st, 2nd and both losing semi-finalists 3rd (§8); fighter IDs, '' while unknown. */
export interface Placings {
  first: string;
  second: string;
  third: string[];
}

export interface Bracket {
  category_id: string;
  matches: BracketMatch[];
  total_rounds: number;
  generated: boolean;
  /** A fight was decided: no regeneration, no adding or removing fighters. */
  locked: boolean;
  placings: Placings;
}

export interface TournamentState {
  name: string;
  date: string;
  categories: WeightCategory[];
  brackets: Record<string, Bracket>;
  active_match_category_id: string;
  active_match_bracket_match_id: string;
}

// ---- Wire frames (mirror server/internal/ws/protocol.go) ----

export type Role = 'operator' | 'judge' | 'viewer';

export interface Session {
  role: Role;
  seat?: number;
}

/** Judge → server, no id and no answer: how many of its taps are still unconfirmed (§7). */
export interface QueueStatusPayload {
  pending: number;
}

/** Client → server. */
export interface ActionFrame {
  id: string;
  type: string;
  payload: unknown;
  client_time?: number;
  offline?: boolean;
}

/** Server → client. */
export interface ServerFrame {
  type: 'STATE_UPDATE' | 'TOURNAMENT_STATE_UPDATE' | 'ACK' | 'NACK' | 'TIME_SYNC' | 'SESSION_REPLACED';
  payload: unknown;
  server_time: number;
  seq?: number;
}

export interface AckPayload {
  id: string;
}

export interface NackPayload {
  id: string;
  reason: string;
}
