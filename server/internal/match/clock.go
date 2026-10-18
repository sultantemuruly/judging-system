package match

// Phase is where the fight clock is.
type Phase string

const (
	NotStarted Phase = "NOT_STARTED"
	Running    Phase = "RUNNING"
	Paused     Phase = "PAUSED"
	Rest       Phase = "REST"  // between rounds
	Ended      Phase = "ENDED" // the last round is over
)

// interval is a stretch of running time; End is 0 while it is still open.
type interval struct {
	Start, End int64
}

type roundClock struct {
	Intervals []interval
	EndedAt   int64
}

func (f *Fight) currentRound() *roundClock { return &f.rounds[f.round-1] }

func (f *Fight) startRound(at int64) error {
	if _, stopped := f.stopped(); stopped {
		return ErrFightStopped
	}
	if f.medical != 0 {
		return ErrMedicalTimeoutBusy
	}
	switch {
	case f.phase == NotStarted:
	case f.phase == Rest && f.round < f.Config.Rounds:
	default:
		return ErrClockState
	}
	f.round++
	f.rounds = append(f.rounds, roundClock{Intervals: []interval{{Start: at}}})
	f.phase = Running
	return nil
}

func (f *Fight) pause(at int64) error {
	if f.phase != Running {
		return ErrClockState
	}
	f.stopClock(at)
	return nil
}

func (f *Fight) resume(at int64) error {
	if f.phase != Paused {
		return ErrClockState
	}
	if _, stopped := f.stopped(); stopped {
		return ErrFightStopped
	}
	if f.medical != 0 {
		return ErrMedicalTimeoutBusy
	}
	r := f.currentRound()
	r.Intervals = append(r.Intervals, interval{Start: at})
	f.phase = Running
	return nil
}

func (f *Fight) endRound(at int64) error {
	if f.phase != Running && f.phase != Paused {
		return ErrClockState
	}
	f.stopClock(at)
	f.currentRound().EndedAt = at
	if f.round < f.Config.Rounds {
		f.phase = Rest
	} else {
		f.phase = Ended
	}
	return nil
}

// stopClock closes the open interval, if any, and pauses a running round.
func (f *Fight) stopClock(at int64) {
	if f.phase != Running {
		return
	}
	r := f.currentRound()
	r.Intervals[len(r.Intervals)-1].End = at
	f.phase = Paused
}

// elapsedMs is the running time of the current round at server time now.
func (f Fight) elapsedMs(now int64) int64 {
	if f.round == 0 {
		return 0
	}
	var total int64
	for _, iv := range f.rounds[f.round-1].Intervals {
		end := iv.End
		if end == 0 {
			end = now
		}
		total += end - iv.Start
	}
	return total
}

// closedElapsedMs is the running time of the current round excluding the open interval.
func (f Fight) closedElapsedMs() int64 {
	if f.round == 0 {
		return 0
	}
	var total int64
	for _, iv := range f.rounds[f.round-1].Intervals {
		if iv.End != 0 {
			total += iv.End - iv.Start
		}
	}
	return total
}

func (f Fight) runningSince() int64 {
	if f.phase != Running {
		return 0
	}
	ivs := f.rounds[f.round-1].Intervals
	return ivs[len(ivs)-1].Start
}

// RoundEndsAt is the server time at which the running round reaches 0:00.
func (f Fight) RoundEndsAt() (int64, bool) {
	if f.phase != Running {
		return 0, false
	}
	return f.runningSince() + f.Config.roundMs() - f.closedElapsedMs(), true
}

// MedicalEndsAt is when a running medical timeout reaches 0:00.
func (f Fight) MedicalEndsAt() (int64, bool) {
	if f.medical == 0 {
		return 0, false
	}
	return f.medical + MedicalTimeoutMs, true
}

// CurrentRound is the 1-based number of the current round, 0 before the first one.
func (f Fight) CurrentRound() int { return f.round }

// Phase is where the clock is.
func (f Fight) Phase() Phase { return f.phase }

// roundAcceptingAt returns the round in which a tap made at t counts: its
// running time contains t (an open interval counts up to now), or t is at most
// GongGraceMs after its gong (§3). 0 if none.
func (f Fight) roundAcceptingAt(t, now int64) int {
	for i, r := range f.rounds {
		for _, iv := range r.Intervals {
			end := iv.End
			if end == 0 {
				end = now
			}
			if t >= iv.Start && t <= end {
				return i + 1
			}
		}
		if r.EndedAt > 0 && t > r.EndedAt && t <= r.EndedAt+GongGraceMs {
			return i + 1
		}
	}
	return 0
}

// roundUndoableAt returns the round in which a judge's undo made at t applies:
// from the round's start until JudgeUndoWindowMs after its gong (§3). 0 if none.
func (f Fight) roundUndoableAt(t int64) int {
	for i, r := range f.rounds {
		if t < r.Intervals[0].Start {
			continue
		}
		if r.EndedAt == 0 || t <= r.EndedAt+JudgeUndoWindowMs {
			return i + 1
		}
	}
	return 0
}
