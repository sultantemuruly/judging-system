package match

// FightView is everything clients render. It is computed on the server and
// broadcast; clients never recompute scores or verdicts.
type FightView struct {
	FightID  string      `json:"fight_id"`
	RedName  string      `json:"red_name"`
	BlueName string      `json:"blue_name"`
	Category string      `json:"category"`
	Bracket  *BracketRef `json:"bracket"`

	Clock   ClockView             `json:"clock"`
	Judges  []JudgeView           `json:"judges"`
	Corners map[Corner]CornerView `json:"corners"`
	Result  Result                `json:"result"`
	Actions []ActionView          `json:"actions"`
	Medical MedicalView           `json:"medical"`
	// StoppageMethods are the ways the operator may stop the fight right now (§5).
	StoppageMethods []Method `json:"stoppage_methods"`
}

// ClockView lets a client draw the countdown from server time:
// remaining = round_ms − elapsed_ms − (server_now − running_since) while running.
type ClockView struct {
	Phase          Phase `json:"phase"`
	Round          int   `json:"round"`
	Rounds         int   `json:"rounds"`
	RoundMs        int64 `json:"round_ms"`
	RestMs         int64 `json:"rest_ms"`
	ElapsedMs      int64 `json:"elapsed_ms"`       // closed running time of the current round
	RunningSince   int64 `json:"running_since"`    // 0 unless running
	RoundEndedAt   int64 `json:"round_ended_at"`   // gong of the current round, 0 if not ended
	RestEndsAt     int64 `json:"rest_ends_at"`     // 0 unless in rest
	JudgeUndoUntil int64 `json:"judge_undo_until"` // after the gong, judges may undo until then
}

type JudgeView struct {
	Seat      int     `json:"seat"`
	Connected bool    `json:"connected"`
	Rounds    []Score `json:"rounds"` // net per round
	Total     Score   `json:"total"`
	Hits      int     `json:"hits"`
	// Leader is who this judge has ahead right now (total, then last round).
	Leader Corner `json:"leader"`
	// Verdict is set once the last round is over: by points, or by the judge's decision.
	Verdict        Corner `json:"verdict"`
	Decided        bool   `json:"decided"`         // verdict came from the judge's own decision
	DecisionNeeded bool   `json:"decision_needed"` // the judge must choose RED or BLUE now
}

type CornerView struct {
	Warnings        int  `json:"warnings"`
	MinusPoints     int  `json:"minus_points"`
	Penalty         int  `json:"penalty"` // points deducted at every judge
	KnockdownsRound int  `json:"knockdowns_round"`
	KnockdownsFight int  `json:"knockdowns_fight"`
	KnockdownAlert  bool `json:"knockdown_alert"` // one more knockdown in this round reaches the limit
	KnockdownLimit  bool `json:"knockdown_limit"` // limit reached: the operator should stop the fight (RSC)
	NextWarningDQ   bool `json:"next_warning_dq"` // one more official warning disqualifies (§4)
}

// ActionView is one referee action, for the operator's log and undo.
type ActionView struct {
	ID     string    `json:"id"`
	Type   EventType `json:"type"`
	Corner Corner    `json:"corner"`
	Method Method    `json:"method,omitempty"`
	Round  int       `json:"round"`
	At     int64     `json:"at"`
	Undone bool      `json:"undone"`
	// WarningNumber is the official warning's place on the ladder (§4), counting only active warnings.
	WarningNumber int `json:"warning_number,omitempty"`
	// Deduction is what the action costs the corner at every judge.
	Deduction int `json:"deduction,omitempty"`
	// Disqualifies is set on a 4th warning.
	Disqualifies bool `json:"disqualifies,omitempty"`
}

type MedicalView struct {
	Active    bool  `json:"active"`
	StartedAt int64 `json:"started_at"`
	EndsAt    int64 `json:"ends_at"`
}

// View computes what clients see. now is the server time in ms.
func (f Fight) View(now int64) FightView {
	t := f.tally()
	res := f.result()
	v := FightView{
		FightID:  f.Config.FightID,
		RedName:  f.Config.RedName,
		BlueName: f.Config.BlueName,
		Category: f.Config.Category,
		Bracket:  f.Config.Bracket,
		Clock:    f.clockView(),
		Result:   res,
		Actions:  []ActionView{},

		StoppageMethods: f.stoppageMethods(),
	}
	if v.Clock.Phase == "" {
		v.Clock.Phase = NotStarted
	}

	_, stopped := f.stopped()
	for seat := 1; seat <= JudgeCount; seat++ {
		jv := JudgeView{Seat: seat, Rounds: t.judgeRounds(seat)[:max(f.round, 1)], Total: t.judgeTotal(seat), Hits: t.hitCount[seat]}
		jv.Leader = jv.Total.leader()
		if jv.Leader == "" {
			jv.Leader = jv.Rounds[len(jv.Rounds)-1].leader()
		}
		if f.phase == Ended && !stopped {
			jv.Verdict, jv.Decided = t.verdict(seat)
			jv.DecisionNeeded = jv.Verdict == "" && !f.confirmed
		}
		v.Judges = append(v.Judges, jv)
	}

	cur := max(f.round, 1) - 1
	v.Corners = map[Corner]CornerView{}
	for _, c := range []Corner{Red, Blue} {
		cv := CornerView{
			Warnings:        pick(t.warnings, c),
			MinusPoints:     pick(t.minus, c),
			Penalty:         pick(t.minus, c) * MinusPointValue,
			KnockdownsRound: pick(t.kdRound[cur], c),
			KnockdownsFight: pick(t.kdFight, c),
		}
		cv.NextWarningDQ = cv.Warnings == WarningsForDQ-1
		cv.KnockdownLimit = cv.KnockdownsRound >= f.Config.KDLimitRound || cv.KnockdownsFight >= f.Config.KDLimitFight
		cv.KnockdownAlert = !cv.KnockdownLimit && (cv.KnockdownsRound == f.Config.KDLimitRound-1 || cv.KnockdownsFight == f.Config.KDLimitFight-1)
		v.Corners[c] = cv
	}

	v.Actions = f.actionLog()

	if end, ok := f.MedicalEndsAt(); ok {
		v.Medical = MedicalView{Active: true, StartedAt: f.medical, EndsAt: end}
	}
	return v
}

// actionLog lists referee actions with their effect, undone ones included.
func (f Fight) actionLog() []ActionView {
	out := []ActionView{}
	var warnings Score
	for _, e := range f.Events {
		a := ActionView{ID: e.ID, Type: e.Type, Corner: e.Corner, Method: e.Method, Round: e.Round, At: e.At, Undone: f.undone[e.ID]}
		switch e.Type {
		case OfficialWarning:
			if !a.Undone {
				warnings.add(e.Corner, 1)
				a.WarningNumber = pick(warnings, e.Corner)
				if a.WarningNumber == 2 || a.WarningNumber == 3 {
					a.Deduction = MinusPointValue
				}
				a.Disqualifies = a.WarningNumber >= WarningsForDQ
			}
		case MinusPoint:
			a.Deduction = MinusPointValue
		case Knockdown:
			a.Deduction = KnockdownValue
		case Stoppage:
		default:
			continue
		}
		out = append(out, a)
	}
	return out
}

func (f Fight) clockView() ClockView {
	c := ClockView{
		Phase:        f.phase,
		Round:        f.round,
		Rounds:       f.Config.Rounds,
		RoundMs:      f.Config.roundMs(),
		RestMs:       f.Config.restMs(),
		ElapsedMs:    f.closedElapsedMs(),
		RunningSince: f.runningSince(),
	}
	if f.round > 0 && (f.phase == Rest || f.phase == Ended) {
		c.RoundEndedAt = f.currentRound().EndedAt
		c.JudgeUndoUntil = c.RoundEndedAt + JudgeUndoWindowMs
		if f.phase == Rest {
			c.RestEndsAt = c.RoundEndedAt + c.RestMs
		}
	}
	return c
}

func pick(s Score, c Corner) int {
	if c == Red {
		return s.Red
	}
	return s.Blue
}
