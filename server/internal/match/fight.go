package match

import (
	"errors"
	"maps"
)

// Rejection reasons. The message is a stable code that is sent to clients in NACKs.
var (
	ErrDuplicate          = errors.New("duplicate")
	ErrNoFight            = errors.New("no_fight")
	ErrFightExists        = errors.New("fight_exists")
	ErrInvalidConfig      = errors.New("invalid_config")
	ErrInvalidSeat        = errors.New("invalid_seat")
	ErrInvalidCorner      = errors.New("invalid_corner")
	ErrInvalidMethod      = errors.New("invalid_method")
	ErrInvalidActor       = errors.New("invalid_actor")
	ErrClockState         = errors.New("clock_state")
	ErrClockNotRunning    = errors.New("clock_not_running")
	ErrUndoWindowClosed   = errors.New("undo_window_closed")
	ErrNothingToUndo      = errors.New("nothing_to_undo")
	ErrFightStopped       = errors.New("fight_stopped")
	ErrResultConfirmed    = errors.New("result_confirmed")
	ErrResultNotFinal     = errors.New("result_not_final")
	ErrDecisionNotNeeded  = errors.New("decision_not_needed")
	ErrBadTarget          = errors.New("bad_target")
	ErrUnknownEvent       = errors.New("unknown_event")
	ErrMedicalTimeoutBusy = errors.New("medical_timeout_state")
)

// Fight is the state of one fight: its config, the accepted event log, and
// what was folded out of it. Use Apply to change it; the zero value is an
// empty fight that only accepts FightCreated.
type Fight struct {
	Config FightConfig
	Events []Event

	ids       map[string]bool
	undone    map[string]bool
	phase     Phase
	round     int          // current round, 1-based; 0 before the first round
	rounds    []roundClock // index round-1
	decisions [JudgeCount + 1]Corner
	confirmed bool
	medical   int64 // start of a running medical timeout, 0 if none
}

// Apply validates e against the rules and returns the fight with e appended.
// On error the returned fight is f, unchanged.
func Apply(f Fight, e Event) (Fight, error) {
	if e.ID == "" {
		return f, ErrInvalidConfig
	}
	if f.ids[e.ID] {
		return f, ErrDuplicate
	}
	if e.Type != FightCreated && f.Config.FightID == "" {
		return f, ErrNoFight
	}
	n := f.clone()
	if err := n.apply(&e); err != nil {
		return f, err
	}
	n.Events = append(n.Events, e)
	n.ids[e.ID] = true
	return n, nil
}

// Replay folds a stored log back into a fight.
func Replay(events []Event) (Fight, error) {
	var f Fight
	for _, e := range events {
		var err error
		if f, err = Apply(f, e); err != nil {
			return f, err
		}
	}
	return f, nil
}

// Seen reports whether an event with this ID was accepted.
func (f Fight) Seen(id string) bool { return f.ids[id] }

func (f Fight) clone() Fight {
	n := f
	n.ids = maps.Clone(f.ids)
	n.undone = maps.Clone(f.undone)
	if n.ids == nil {
		n.ids = map[string]bool{}
	}
	if n.undone == nil {
		n.undone = map[string]bool{}
	}
	n.rounds = make([]roundClock, len(f.rounds))
	for i, r := range f.rounds {
		n.rounds[i] = roundClock{EndedAt: r.EndedAt, Intervals: append([]interval(nil), r.Intervals...)}
	}
	return n
}

func (f *Fight) apply(e *Event) error {
	if f.confirmed && e.Type != FightCreated {
		return ErrResultConfirmed
	}
	switch e.Type {
	case FightCreated:
		return f.create(e)
	case RoundStarted:
		return f.startRound(e.At)
	case ClockPaused:
		return f.pause(e.At)
	case ClockResumed:
		return f.resume(e.At)
	case RoundEnded:
		return f.endRound(e.At)
	case Hit:
		return f.hit(e)
	case HitUndone:
		return f.undoHit(e)
	case OfficialWarning, MinusPoint, Knockdown:
		return f.refereeAction(e)
	case Stoppage:
		return f.stoppage(e)
	case RefereeActionUndone:
		return f.undoRefereeAction(e)
	case JudgeDecision:
		return f.decide(e)
	case ResultConfirmed:
		return f.confirm()
	case MedicalTimeoutStarted:
		return f.startMedical(e.At)
	case MedicalTimeoutStopped:
		return f.stopMedical()
	}
	return ErrUnknownEvent
}

func (f *Fight) create(e *Event) error {
	if f.Config.FightID != "" {
		return ErrFightExists
	}
	if e.Config == nil || e.Config.FightID == "" {
		return ErrInvalidConfig
	}
	cfg := e.Config.WithDefaults()
	e.Config = &cfg
	f.Config = cfg
	f.phase = NotStarted
	return nil
}

func judgeSeat(e *Event) (int, error) {
	if e.Actor.Kind != Judge || e.Actor.Seat < 1 || e.Actor.Seat > JudgeCount {
		return 0, ErrInvalidSeat
	}
	return e.Actor.Seat, nil
}

func (f *Fight) hit(e *Event) error {
	if _, err := judgeSeat(e); err != nil {
		return err
	}
	if !e.Corner.Valid() {
		return ErrInvalidCorner
	}
	if _, stopped := f.stopped(); stopped {
		return ErrFightStopped
	}
	// A tap is judged by when it was made, so Wi-Fi delay never costs it (§3).
	r := f.roundAcceptingAt(tapTime(e), e.At)
	if r == 0 {
		return ErrClockNotRunning
	}
	e.Round = r
	return nil
}

// tapTime is when a judge's action was made, in server time (§3). A queued
// action is judged by its device time. A live one is too, unless that time is
// implausible for a live send — then the phone's clock is wrong and the time
// the server received it is used. A time after receipt is never possible.
func tapTime(e *Event) int64 {
	switch {
	case e.ClientTime <= 0 || e.ClientTime > e.At:
		return e.At
	case e.Offline:
		return e.ClientTime
	case e.At-e.ClientTime > TapClockSkewMs:
		return e.At
	}
	return e.ClientTime
}

// undoHit removes the judge's last hit made before the undo, in the round
// where the undo was pressed (§3, S19). A queued undo is judged by when it
// was made, like a tap, so it removes the tap the judge meant.
func (f *Fight) undoHit(e *Event) error {
	seat, err := judgeSeat(e)
	if err != nil {
		return err
	}
	at := tapTime(e)
	r := f.roundUndoableAt(at)
	if r == 0 {
		if f.round > 0 && at >= f.rounds[0].Intervals[0].Start {
			return ErrUndoWindowClosed
		}
		return ErrNothingToUndo
	}
	for i := len(f.Events) - 1; i >= 0; i-- {
		h := f.Events[i]
		if h.Type == Hit && h.Actor.Seat == seat && h.Round == r && !f.undone[h.ID] && tapTime(&h) <= at {
			e.TargetID = h.ID
			e.Round = r
			e.Corner = h.Corner
			f.undone[h.ID] = true
			return nil
		}
	}
	return ErrNothingToUndo
}

func (f *Fight) refereeAction(e *Event) error {
	if e.Actor.Kind != Operator {
		return ErrInvalidActor
	}
	if !e.Corner.Valid() {
		return ErrInvalidCorner
	}
	if _, stopped := f.stopped(); stopped {
		return ErrFightStopped
	}
	switch f.phase {
	case Running, Paused:
	case Rest, Ended:
		// A knockdown only happens while a round is on; warnings and minus
		// points may also be given at the gong or during the rest.
		if e.Type == Knockdown {
			return ErrClockState
		}
	default:
		return ErrClockState
	}
	e.Round = f.round
	if e.Type == OfficialWarning {
		// The 4th warning disqualifies: stop the clock like any stoppage.
		if f.warningsAfter(e) >= WarningsForDQ {
			f.stopClock(e.At)
		}
	}
	return nil
}

// warningsAfter counts the active official warnings of e.Corner including e.
func (f *Fight) warningsAfter(e *Event) int {
	n := 1
	for _, x := range f.Events {
		if x.Type == OfficialWarning && x.Corner == e.Corner && !f.undone[x.ID] {
			n++
		}
	}
	return n
}

func (f *Fight) stoppage(e *Event) error {
	if e.Actor.Kind != Operator {
		return ErrInvalidActor
	}
	if !e.Corner.Valid() {
		return ErrInvalidCorner
	}
	if !e.Method.IsStoppage() {
		return ErrInvalidMethod
	}
	if _, stopped := f.stopped(); stopped {
		return ErrFightStopped
	}
	switch f.phase {
	case Running, Paused, Rest:
	case Ended:
		// After the final gong a fighter can still be disqualified or give up;
		// nobody can be knocked out any more (§5).
		if e.Method != DQ && e.Method != AB {
			return ErrClockState
		}
	default:
		return ErrClockState
	}
	e.Round = f.round
	f.stopClock(e.At)
	return nil
}

// stoppageMethods lists what stoppage() would accept now.
func (f Fight) stoppageMethods() []Method {
	if _, stopped := f.stopped(); stopped || f.confirmed {
		return []Method{}
	}
	switch f.phase {
	case Running, Paused, Rest:
		return []Method{KO, RSC, DQ, AB}
	case Ended:
		return []Method{DQ, AB}
	}
	return []Method{}
}

func (f *Fight) undoRefereeAction(e *Event) error {
	if e.Actor.Kind != Operator {
		return ErrInvalidActor
	}
	for _, x := range f.Events {
		if x.ID != e.TargetID {
			continue
		}
		switch x.Type {
		case OfficialWarning, MinusPoint, Knockdown, Stoppage:
		default:
			return ErrBadTarget
		}
		if f.undone[x.ID] {
			return ErrBadTarget
		}
		f.undone[x.ID] = true
		e.Round = x.Round
		e.Corner = x.Corner
		return nil
	}
	return ErrBadTarget
}

func (f *Fight) decide(e *Event) error {
	seat, err := judgeSeat(e)
	if err != nil {
		return err
	}
	if !e.Corner.Valid() {
		return ErrInvalidCorner
	}
	if f.phase != Ended {
		return ErrDecisionNotNeeded
	}
	if _, stopped := f.stopped(); stopped {
		return ErrDecisionNotNeeded
	}
	if _, byPoints := f.tally().pointsVerdict(seat); byPoints {
		return ErrDecisionNotNeeded
	}
	f.decisions[seat] = e.Corner
	return nil
}

func (f *Fight) confirm() error {
	if !f.result().Final {
		return ErrResultNotFinal
	}
	f.confirmed = true
	return nil
}

func (f *Fight) startMedical(at int64) error {
	if f.medical != 0 {
		return ErrMedicalTimeoutBusy
	}
	if f.phase == NotStarted || f.phase == Ended {
		return ErrClockState
	}
	f.stopClock(at)
	f.medical = at
	return nil
}

func (f *Fight) stopMedical() error {
	if f.medical == 0 {
		return ErrMedicalTimeoutBusy
	}
	f.medical = 0
	return nil
}

// stopped returns the decided result when a stoppage or a 4th warning ended the fight.
func (f Fight) stopped() (Result, bool) {
	t := f.tally()
	if t.stop != nil {
		return *t.stop, true
	}
	return Result{}, false
}
