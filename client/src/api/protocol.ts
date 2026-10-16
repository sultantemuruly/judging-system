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
}

export interface CornerView {
  warnings: number;
  minus_points: number;
  penalty: number;
  knockdowns_round: number;
  knockdowns_fight: number;
  knockdown_alert: boolean;
  knockdown_limit: boolean;
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
  live_scores: boolean;
}

const emptyCorner: CornerView = {
  warnings: 0, minus_points: 0, penalty: 0,
  knockdowns_round: 0, knockdowns_fight: 0, knockdown_alert: false, knockdown_limit: false,
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
  live_scores: true,
};
