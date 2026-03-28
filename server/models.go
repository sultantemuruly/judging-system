package main

// Fighter represents the corner colour
type Fighter string

const (
	RedFighter  Fighter = "Red"
	BlueFighter Fighter = "Blue"
)

// Hit represents a single strike registered by a judge
type Hit struct {
	ID        string  `json:"id"`
	Fighter   Fighter `json:"fighter"`
	Time      int64   `json:"time"`      // Time in ms since round start
	Type      string  `json:"type"`      // "normal"
	Timestamp int64   `json:"timestamp"` // Unix timestamp in ms
}

// JudgeHitTracker tracks hits registered by a specific judge in a round
type JudgeHitTracker struct {
	JudgeID string `json:"judge_id"`
	Hits    []Hit  `json:"hits"`
}

// OfficialWarning represents a warning issued to a fighter (for history)
type OfficialWarning struct {
	ID      string  `json:"id"`
	Fighter Fighter `json:"fighter"`
	Round   int     `json:"round"`
	Time    int64   `json:"time"`
}

type RoundStatusType string

const (
	RoundNotStarted RoundStatusType = "ROUND_NOT_STARTED"
	RoundRunning    RoundStatusType = "ROUND_RUNNING"
	RoundPaused     RoundStatusType = "ROUND_PAUSED"
	RoundEnded      RoundStatusType = "ROUND_ENDED"
)

// RoundState represents the state of a single round
type RoundState struct {
	RoundID        int                         `json:"round_id"`
	Status         RoundStatusType             `json:"status"`
	StartTime      *int64                      `json:"start_time"`
	EndTime        *int64                      `json:"end_time"`
	ElapsedTime    int64                       `json:"elapsed_time"`
	LastResumeTime *int64                      `json:"last_resume_time"`
	JudgeHits      map[string]*JudgeHitTracker `json:"judge_hits"`
	Knockdowns     map[string]int              `json:"knockdowns"` // "Red" -> count, "Blue" -> count
}

// MatchState represents the overall state of the fight
type MatchState struct {
	MatchID          string              `json:"match_id"`
	CurrentRound     int                 `json:"current_round"`
	Rounds           []RoundState        `json:"rounds"`
	MatchWinner      *Fighter            `json:"match_winner"`
	MatchResult      string              `json:"match_result"`       // "DECISION", "TKO", "DQ", ""
	OfficialWarnings map[string]int      `json:"official_warnings"`  // "Red" -> count, "Blue" -> count
	WarningPenalties map[string]int      `json:"warning_penalties"`  // "Red" -> total penalty pts, "Blue" -> total
	WarningHistory   []OfficialWarning   `json:"warning_history"`    // Ordered list for display
	Disqualified     *Fighter            `json:"disqualified"`       // Set when 4 warnings
	FightEnded       bool                `json:"fight_ended"`        // True if TKO/DQ/completed
	RedFighterName   string              `json:"red_fighter_name"`
	BlueFighterName  string              `json:"blue_fighter_name"`
	CategoryName     string              `json:"category_name"`
	RestEndTime      *int64              `json:"rest_end_time"`
	RoundDuration    int                 `json:"round_duration"`      // Configurable seconds
	RestDuration     int                 `json:"rest_duration"`       // Configurable seconds
}

// ClientMessage is the structure of incoming WS messages
type ClientMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

// ServerMessage is the structure of outgoing WS messages
type ServerMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}
