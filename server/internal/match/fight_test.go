package match

import (
	"reflect"
	"testing"
)

func TestHitsOnlyWhileClockRuns(t *testing.T) {
	s := newScript(t, FightConfig{})
	tap := Event{Type: Hit, Actor: judge(1), Corner: Red}
	s.reject(tap, ErrClockNotRunning) // before the first round
	s.startRound()
	s.must(Event{Type: ClockPaused})
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
