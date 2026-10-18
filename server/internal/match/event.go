package match

// Corner is a fighter's corner. Only Red and Blue exist; there is no draw.
type Corner string

const (
	Red  Corner = "Red"
	Blue Corner = "Blue"
)

func (c Corner) Valid() bool { return c == Red || c == Blue }

func (c Corner) Opponent() Corner {
	if c == Red {
		return Blue
	}
	return Red
}

// Method is how a fight was won (§5).
type Method string

const (
	PTS Method = "PTS" // points, 3:0 or 2:1
	KO  Method = "KO"  // knockout
	RSC Method = "RSC" // referee stops contest
	DQ  Method = "DQ"  // opponent disqualified
	AB  Method = "AB"  // opponent abandoned
	WO  Method = "WO"  // opponent did not show (bracket only, no fight is run)
)

// StoppageMethods are the methods an operator may enter during a fight.
func (m Method) IsStoppage() bool { return m == KO || m == RSC || m == DQ || m == AB }

type ActorKind string

const (
	Operator ActorKind = "operator"
	Judge    ActorKind = "judge"
	System   ActorKind = "system"
)

// Actor is who caused an event. Seat is 1–3 for judges.
type Actor struct {
	Kind ActorKind `json:"kind"`
	Seat int       `json:"seat,omitempty"`
}

type EventType string

const (
	FightCreated          EventType = "FightCreated"
	RoundStarted          EventType = "RoundStarted"
	ClockPaused           EventType = "ClockPaused"
	ClockResumed          EventType = "ClockResumed"
	RoundEnded            EventType = "RoundEnded"
	Hit                   EventType = "Hit"
	HitUndone             EventType = "HitUndone"
	OfficialWarning       EventType = "OfficialWarning"
	MinusPoint            EventType = "MinusPoint"
	Knockdown             EventType = "Knockdown"
	Stoppage              EventType = "Stoppage"
	RefereeActionUndone   EventType = "RefereeActionUndone"
	JudgeDecision         EventType = "JudgeDecision"
	ResultConfirmed       EventType = "ResultConfirmed"
	MedicalTimeoutStarted EventType = "MedicalTimeoutStarted"
	MedicalTimeoutStopped EventType = "MedicalTimeoutStopped"
)

// Event is one entry of a fight's append-only log. It is flat so it can be
// written to disk as one JSON line. Only the fields a type needs are set.
//
// Round and TargetID (for HitUndone) are filled in by Apply, so the stored
// event records exactly what it did and replaying the log is deterministic.
type Event struct {
	ID    string    `json:"id"`
	Type  EventType `json:"type"`
	Actor Actor     `json:"actor"`
	At    int64     `json:"at"` // server time, ms

	Corner   Corner `json:"corner,omitempty"`
	Method   Method `json:"method,omitempty"`
	TargetID string `json:"target_id,omitempty"`
	Round    int    `json:"round,omitempty"`

	// ClientTime is the device time of a tap converted to server time (ms).
	// Offline marks an action that was queued or resent: it is judged by
	// ClientTime instead of by when the server received it (§3).
	ClientTime int64 `json:"client_time,omitempty"`
	Offline    bool  `json:"offline,omitempty"`

	Config *FightConfig `json:"config,omitempty"`
}

// BracketRef links a fight to the bracket match it decides.
type BracketRef struct {
	CategoryID string `json:"category_id"`
	MatchID    string `json:"match_id"`
}

// FightConfig is the payload of FightCreated.
type FightConfig struct {
	FightID      string      `json:"fight_id"`
	RedName      string      `json:"red_name"`
	BlueName     string      `json:"blue_name"`
	Category     string      `json:"category"`
	Rounds       int         `json:"rounds"`
	RoundSeconds int         `json:"round_seconds"`
	RestSeconds  int         `json:"rest_seconds"`
	KDLimitRound int         `json:"kd_limit_round"`
	KDLimitFight int         `json:"kd_limit_fight"`
	Bracket      *BracketRef `json:"bracket,omitempty"`
}

// WithDefaults fills zero values with the default format and limits.
func (c FightConfig) WithDefaults() FightConfig {
	if c.Rounds <= 0 {
		c.Rounds = DefaultRounds
	}
	if c.RoundSeconds <= 0 {
		c.RoundSeconds = DefaultRoundSeconds
	}
	if c.RestSeconds <= 0 {
		c.RestSeconds = DefaultRestSeconds
	}
	if c.KDLimitRound <= 0 {
		c.KDLimitRound = DefaultKDLimitRound
	}
	if c.KDLimitFight <= 0 {
		c.KDLimitFight = DefaultKDLimitFight
	}
	return c
}

func (c FightConfig) roundMs() int64 { return int64(c.RoundSeconds) * 1000 }
func (c FightConfig) restMs() int64  { return int64(c.RestSeconds) * 1000 }
