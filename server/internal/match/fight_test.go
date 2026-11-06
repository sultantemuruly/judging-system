package match

import (
	"reflect"
	"slices"
	"testing"
)

func TestHitsOnlyWhileClockRuns(t *testing.T) {
	s := newScript(t, FightConfig{})
	tap := Event{Type: Hit, Actor: judge(1), Corner: Red}
	s.reject(tap, ErrClockNotRunning) // before the first round
	s.startRound()
	s.advance(1000)
	s.must(Event{Type: ClockPaused})
	s.advance(1000)
	s.reject(tap, ErrClockNotRunning)
	s.must(Event{Type: ClockResumed})
	s.must(tap)
	s.endRound()
	s.advance(GongGraceMs + 1)
	s.reject(tap, ErrClockNotRunning) // rest
}

func TestRejectsInvalidSeatAndCorner(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.reject(Event{Type: Hit, Actor: judge(4), Corner: Red}, ErrInvalidSeat)
	s.reject(Event{Type: Hit, Actor: op(), Corner: Red}, ErrInvalidSeat)
	s.reject(Event{Type: Hit, Actor: judge(1), Corner: "Draw"}, ErrInvalidCorner)
	s.reject(Event{Type: Knockdown, Corner: "Green"}, ErrInvalidCorner)
	s.reject(Event{Type: Stoppage, Corner: Red, Method: PTS}, ErrInvalidMethod)
}

func TestDirectMinusPointDoesNotAdvanceWarnings(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.hits(1, 10, 10)
	for range 3 {
		s.referee(MinusPoint, Red)
	}
	s.referee(OfficialWarning, Red)

	c := s.view().Corners[Red]
	if c.Warnings != 1 || c.MinusPoints != 3 || s.view().Result.Final {
		t.Fatalf("red = %+v result = %+v, want 1 warning, 3 minus points, no DQ", c, s.view().Result)
	}
	s.wantTotal(1, Score{1, 10})
}

func TestUndoStoppageReopensFight(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.must(Event{Type: Stoppage, Corner: Blue, Method: KO})
	stop := s.f.Events[len(s.f.Events)-1].ID
	s.wantResult(Blue, KO, "")

	s.must(Event{Type: RefereeActionUndone, TargetID: stop})
	if r := s.view().Result; r.Final {
		t.Fatalf("result = %+v, want not final after undo", r)
	}
	if p := s.view().Clock.Phase; p != Paused {
		t.Fatalf("phase = %s, want PAUSED", p)
	}
	s.must(Event{Type: ClockResumed})
}

func TestConfirmLocksTheFight(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.reject(Event{Type: ResultConfirmed}, ErrResultNotFinal)
	s.startRound()
	s.must(Event{Type: Stoppage, Corner: Red, Method: RSC})
	s.must(Event{Type: ResultConfirmed})
	if !s.view().Result.Confirmed {
		t.Fatal("result should be confirmed")
	}
	stop := s.f.Events[len(s.f.Events)-2].ID
	s.reject(Event{Type: RefereeActionUndone, TargetID: stop}, ErrResultConfirmed)
	s.reject(Event{Type: Hit, Actor: judge(1), Corner: Red, Offline: true, ClientTime: startTime}, ErrResultConfirmed)
}

func TestRoundsFollowConfig(t *testing.T) {
	s := newScript(t, FightConfig{Rounds: 2, RoundSeconds: 90})
	if v := s.view().Clock; v.Rounds != 2 || v.RoundMs != 90_000 || v.RestMs != DefaultRestSeconds*1000 {
		t.Fatalf("clock = %+v, want 2 rounds of 90 s with default rest", v)
	}
	s.startRound()
	s.endRound()
	if p := s.view().Clock.Phase; p != Rest {
		t.Fatalf("after round 1: %s, want REST", p)
	}
	s.startRound()
	s.endRound()
	if p := s.view().Clock.Phase; p != Ended {
		t.Fatalf("after round 2: %s, want ENDED", p)
	}
	s.reject(Event{Type: RoundStarted}, ErrClockState)
}

func TestRoundEndsAtAccountsForPauses(t *testing.T) {
	s := newScript(t, FightConfig{RoundSeconds: 120})
	s.startRound()
	s.advance(30_000)
	s.must(Event{Type: ClockPaused})
	s.advance(45_000)
	s.must(Event{Type: ClockResumed})
	end, ok := s.f.RoundEndsAt()
	if !ok || end != s.now+90_000 {
		t.Fatalf("RoundEndsAt = %d (%v), want now+90s", end-s.now, ok)
	}
}

func TestDuplicateIDIsRejectedWithoutChange(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.must(Event{ID: "tap-1", Type: Hit, Actor: judge(1), Corner: Red})
	before := s.f
	if err := s.try(Event{ID: "tap-1", Type: Hit, Actor: judge(1), Corner: Red}); err != ErrDuplicate {
		t.Fatalf("got %v, want ErrDuplicate", err)
	}
	s.f = before
	s.wantTotal(1, Score{1, 0})
}

func TestReplayRebuildsTheSameView(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.playRounds(totals(Score{8, 3}, Score{2, 9}, Score{5, 5}), func(round int) {
		if round == 1 {
			s.referee(OfficialWarning, Blue)
			s.must(Event{Type: HitUndone, Actor: judge(1)})
		}
	})
	s.must(Event{Type: JudgeDecision, Actor: judge(3), Corner: Red})

	replayed, err := Replay(s.f.Events)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := replayed.View(s.now), s.view(); !reflect.DeepEqual(got, want) {
		t.Fatalf("replayed view differs:\n got %+v\nwant %+v", got, want)
	}
}

func TestActionLogNumbersActiveWarnings(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.referee(OfficialWarning, Red)
	s.referee(OfficialWarning, Red)
	second := s.f.Events[len(s.f.Events)-1].ID
	s.must(Event{Type: RefereeActionUndone, TargetID: second})
	s.referee(OfficialWarning, Red)
	s.referee(OfficialWarning, Red)
	s.referee(Knockdown, Blue)

	type row struct {
		n, deduction int
		undone       bool
	}
	var got []row
	for _, a := range s.view().Actions {
		got = append(got, row{a.WarningNumber, a.Deduction, a.Undone})
	}
	want := []row{{1, 0, false}, {0, 0, true}, {2, 3, false}, {3, 3, false}, {0, 1, false}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("log = %+v, want %+v", got, want)
	}
}

func TestMedicalTimeoutStopsTheClock(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.reject(Event{Type: MedicalTimeoutStarted}, ErrClockState)
	s.startRound()
	s.advance(10_000)
	s.must(Event{Type: MedicalTimeoutStarted})
	if v := s.view(); v.Clock.Phase != Paused || !v.Medical.Active || v.Medical.EndsAt != s.now+MedicalTimeoutMs {
		t.Fatalf("view = %+v %+v, want paused with a 2-minute medical timer", v.Clock, v.Medical)
	}
	s.reject(Event{Type: ClockResumed}, ErrMedicalTimeoutBusy)
	s.advance(60_000)
	s.must(Event{Type: MedicalTimeoutStopped})
	s.must(Event{Type: ClockResumed})
	if v := s.view(); v.Medical.Active || v.Clock.ElapsedMs != 10_000 {
		t.Fatalf("after timeout: %+v %+v, want round time unchanged by the timeout", v.Medical, v.Clock)
	}
}

func TestTapWithImplausiblePhoneTimeUsesReceiptTime(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.advance(30_000)
	s.endRound()
	s.advance(1000)
	// A live tap claiming to be made 20 s ago: the phone clock is wrong.
	s.reject(Event{Type: Hit, Actor: judge(1), Corner: Red, ClientTime: s.now - 20_000}, ErrClockNotRunning)
	// A tap claiming a time after it arrived is judged by its arrival.
	s.reject(Event{Type: Hit, Actor: judge(1), Corner: Red, ClientTime: s.now + 60_000}, ErrClockNotRunning)
}

func TestNoTapsAfterStoppage(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.advance(5_000)
	s.must(Event{Type: Stoppage, Corner: Red, Method: KO})
	s.advance(3000)
	s.reject(Event{Type: Hit, Actor: judge(1), Corner: Blue}, ErrFightStopped)
	s.reject(Event{Type: Hit, Actor: judge(1), Corner: Blue, Offline: true, ClientTime: s.now - 1000}, ErrFightStopped)
}

// A tap made before a stoppage but received after it counts, so it isn't
// lost when the stoppage turns out to be a mistake and is undone (§3).
func TestTapMadeBeforeStoppageSurvivesItsUndo(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.advance(5_000)
	madeAt := s.now
	s.advance(200)
	s.must(Event{ID: "rsc", Type: Stoppage, Corner: Red, Method: RSC})
	s.advance(300)
	s.must(Event{Type: Hit, Actor: judge(1), Corner: Blue, ClientTime: madeAt})
	s.must(Event{Type: RefereeActionUndone, TargetID: "rsc"})
	s.wantTotal(1, Score{Blue: 1})
}

func TestTapMadeBeforeDisqualifyingWarningCounts(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.advance(1000)
	for range WarningsForDQ - 1 {
		s.referee(OfficialWarning, Red)
	}
	madeAt := s.now
	s.advance(100)
	s.referee(OfficialWarning, Red) // 4th: disqualified
	s.advance(300)
	s.must(Event{Type: Hit, Actor: judge(2), Corner: Blue, ClientTime: madeAt})
	s.reject(Event{Type: Hit, Actor: judge(2), Corner: Blue}, ErrFightStopped)
}

// Gong grace (§3) runs from when the clock stopped: ending a round from a
// pause gives none, so a stale phone can't add a tap made while time stood.
func TestNoGongGraceWhenRoundEndsFromPause(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.advance(10_000)
	s.must(Event{Type: ClockPaused})
	s.advance(60_000)
	s.endRound()
	s.advance(300)
	s.reject(Event{Type: Hit, Actor: judge(1), Corner: Red}, ErrClockNotRunning)
}

func TestQueuedTapWithImplausiblyOldTimeRefused(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.advance(20 * 60_000) // a long round, so only the age decides
	s.reject(Event{Type: Hit, Actor: judge(1), Corner: Red, Offline: true, ClientTime: s.now - MaxQueuedTapAgeMs - 1}, ErrTapTooOld)
	s.reject(Event{Type: HitUndone, Actor: judge(1), Offline: true, ClientTime: s.now - MaxQueuedTapAgeMs - 1}, ErrTapTooOld)
	s.must(Event{Type: Hit, Actor: judge(1), Corner: Red, Offline: true, ClientTime: s.now - MaxQueuedTapAgeMs + 1000})
}

// A log is loaded by trusting the rounds its taps were accepted in, so a rule
// change in a newer version can't stop a saved fight from loading.
func TestReplayTrustsStoredRounds(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.advance(1000)
	s.must(Event{ID: "tap", Type: Hit, Actor: judge(1), Corner: Red})
	s.must(Event{ID: "undo", Type: HitUndone, Actor: judge(1)})
	s.must(Event{ID: "tap2", Type: Hit, Actor: judge(1), Corner: Blue})
	events := append([]Event(nil), s.f.Events...)
	// Pretend tap2 is outside every round by today's rules.
	for i := range events {
		if events[i].ID == "tap2" {
			events[i].At, events[i].ClientTime = 1, 0
		}
	}
	f, err := Replay(events)
	if err != nil {
		t.Fatalf("replay refused a stored log: %v", err)
	}
	if got := f.View(s.now).Judges[0].Total; got != (Score{Blue: 1}) {
		t.Fatalf("judge 1 after replay = %+v, want blue 1", got)
	}
	if _, err := Apply(f, Event{ID: "late", Type: Hit, Actor: judge(1), Corner: Red, At: 1}); err == nil {
		t.Fatal("after replay new taps must be validated again")
	}
}

func TestQueuedTapJustAfterGongCounts(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.advance(30_000)
	s.endRound()
	gong := s.now
	s.advance(20_000)
	s.must(Event{Type: Hit, Actor: judge(1), Corner: Red, Offline: true, ClientTime: gong + 300})
	s.reject(Event{Type: Hit, Actor: judge(1), Corner: Red, Offline: true, ClientTime: gong + 600}, ErrClockNotRunning)
	s.wantTotal(1, Score{1, 0})
}

func TestDQOrABAfterFinalGong(t *testing.T) {
	for _, m := range []Method{DQ, AB} {
		s := newScript(t, FightConfig{Rounds: 1})
		s.startRound()
		s.hits(1, 3, 1)
		s.endRound()
		s.must(Event{Type: Stoppage, Corner: Blue, Method: m})
		s.wantResult(Blue, m, "")
	}
	s := newScript(t, FightConfig{Rounds: 1})
	s.startRound()
	s.endRound()
	s.reject(Event{Type: Stoppage, Corner: Blue, Method: KO}, ErrClockState)
	s.reject(Event{Type: Stoppage, Corner: Blue, Method: RSC}, ErrClockState)
}

func TestViewListsAllowedStoppages(t *testing.T) {
	s := newScript(t, FightConfig{Rounds: 1})
	want := func(ms ...Method) {
		t.Helper()
		if got := s.view().StoppageMethods; !reflect.DeepEqual(got, append([]Method{}, ms...)) {
			t.Fatalf("stoppage methods = %v, want %v", got, ms)
		}
		for _, m := range []Method{KO, RSC, DQ, AB} {
			allowed := slices.Contains(ms, m)
			_, err := Apply(s.f, Event{ID: "probe", Type: Stoppage, Actor: op(), Corner: Red, Method: m, At: s.now})
			if (err == nil) != allowed {
				t.Fatalf("%s: view says allowed=%v, Apply says %v", m, allowed, err)
			}
		}
	}
	want()
	s.startRound()
	want(KO, RSC, DQ, AB)
	s.endRound()
	want(DQ, AB)
	s.must(Event{Type: Stoppage, Corner: Red, Method: AB})
	want()
}
