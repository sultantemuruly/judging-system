package match

import (
	"testing"
)

// Tests named TestSpec_SNN mirror the worked scenarios of TECHNICAL_SPECIFICATION.md §10.

func TestSpec_S01_MajorityTwoToOne(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.playRounds(totals(Score{30, 25}, Score{28, 29}, Score{31, 27}), nil)

	s.wantVerdict(1, Red)
	s.wantVerdict(2, Blue)
	s.wantVerdict(3, Red)
	s.wantResult(Red, PTS, "2:1")
}

func TestSpec_S02_SumAcrossRounds(t *testing.T) {
	s := newScript(t, FightConfig{})
	// Judge 1 gives rounds 2 and 3 to Blue but has Red ahead on the sum.
	s.playRounds([]card{
		{{10, 5}, {1, 0}, {1, 0}},
		{{6, 7}},
		{{4, 5}},
	}, nil)

	s.wantTotal(1, Score{20, 17})
	s.wantVerdict(1, Red)
}

func TestSpec_S03_TwoWarningsCostThreePoints(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.playRounds(totals(Score{1, 0}, Score{25, 23}, Score{1, 0}), func(round int) {
		if round == 1 {
			s.referee(OfficialWarning, Red)
			s.referee(OfficialWarning, Red)
		}
	})

	s.wantTotal(2, Score{22, 23})
	s.wantVerdict(2, Blue)
	if c := s.view().Corners[Red]; c.Warnings != 2 || c.MinusPoints != 1 || c.Penalty != 3 {
		t.Fatalf("red corner = %+v, want 2 warnings, 1 minus point, penalty 3", c)
	}
}

func TestSpec_S04_TieBrokenByLastRound(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.playRounds([]card{
		{{1, 0}, {7, 6}, {1, 0}},
		{{}, {7, 6}},
		{{}, {6, 8}},
	}, nil)

	s.wantTotal(2, Score{20, 20})
	s.wantVerdict(2, Blue)
}

func TestSpec_S05_DoubleTieNeedsJudgeDecision(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.playRounds([]card{
		{{5, 0}, {5, 0}, {7, 6}},
		{{}, {}, {6, 7}},
		{{}, {}, {7, 7}},
	}, nil)

	s.wantTotal(3, Score{20, 20})
	j3 := s.view().Judges[2]
	if !j3.DecisionNeeded || j3.Verdict != "" {
		t.Fatalf("judge 3 = %+v, want decision needed", j3)
	}
	if s.view().Result.Final {
		t.Fatal("result must wait for judge 3")
	}
	// Only the tied judge may decide.
	s.reject(Event{Type: JudgeDecision, Actor: judge(1), Corner: Blue}, ErrDecisionNotNeeded)

	s.must(Event{Type: JudgeDecision, Actor: judge(3), Corner: Blue})
	s.wantVerdict(3, Blue)
	if !s.view().Judges[2].Decided {
		t.Fatal("judge 3 verdict should be marked as a personal decision")
	}
	s.wantResult(Red, PTS, "2:1")
}

func TestSpec_S06_NoTapsStillVotes(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.playRounds(totals(Score{}, Score{3, 5}, Score{2, 4}), func(round int) {
		// Deductions alone must not decide for a judge who pressed nothing.
		if round == 1 {
			s.referee(Knockdown, Blue)
		}
	})

	j1 := s.view().Judges[0]
	if !j1.DecisionNeeded {
		t.Fatalf("judge 1 = %+v, want decision needed", j1)
	}
	s.must(Event{Type: JudgeDecision, Actor: judge(1), Corner: Blue})
	s.wantResult(Blue, PTS, "3:0")
}

func TestSpec_S07_FourthWarningDQ(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.hits(1, 0, 5)
	s.advance(1000)
	s.endRound()
	s.advance(60_000)
	s.startRound()
	for range 4 {
		s.referee(OfficialWarning, Blue)
	}

	s.wantResult(Red, DQ, "")
	if p := s.view().Clock.Phase; p != Paused {
		t.Fatalf("clock phase = %s, want PAUSED after DQ", p)
	}
	s.reject(Event{Type: ClockResumed}, ErrFightStopped)
	s.reject(Event{Type: OfficialWarning, Corner: Blue}, ErrFightStopped)
}

func TestSpec_S08_ThreeKnockdownsFlagRSC(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.referee(Knockdown, Blue)
	s.referee(Knockdown, Blue)
	if c := s.view().Corners[Blue]; !c.KnockdownAlert || c.KnockdownLimit {
		t.Fatalf("after 2 knockdowns: %+v, want alert only", c)
	}
	s.referee(Knockdown, Blue)

	if c := s.view().Corners[Blue]; !c.KnockdownLimit {
		t.Fatalf("after 3 knockdowns: %+v, want limit reached", c)
	}
	// The system only proposes; the operator stops the fight.
	if s.view().Result.Final {
		t.Fatal("result must not be final before the operator stops the fight")
	}
	s.must(Event{Type: Stoppage, Corner: Red, Method: RSC})
	s.wantResult(Red, RSC, "")
}

func TestSpec_S08_FourKnockdownsInFightReachLimit(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.referee(Knockdown, Blue)
	s.referee(Knockdown, Blue)
	s.endRound()
	s.startRound()
	s.referee(Knockdown, Blue)
	if s.view().Corners[Blue].KnockdownLimit {
		t.Fatal("3 knockdowns over two rounds must not reach the limit")
	}
	s.referee(Knockdown, Blue)
	if !s.view().Corners[Blue].KnockdownLimit {
		t.Fatal("4 knockdowns in the fight must reach the limit")
	}
}

func TestSpec_S09_KnockdownCostsOnePoint(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.playRounds(totals(Score{1, 0}, Score{1, 0}, Score{15, 15}), func(round int) {
		if round == 2 {
			s.referee(Knockdown, Blue)
		}
	})

	s.wantTotal(3, Score{15, 14})
	s.wantVerdict(3, Red)
}

func TestSpec_S10_JudgeUndoWindow(t *testing.T) {
	cases := []struct {
		name      string
		afterGong int64
		want      error
	}{
		{"8s after gong is removed", 8_000, nil},
		{"15s after gong is refused", 15_000, ErrUndoWindowClosed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := newScript(t, FightConfig{})
			s.startRound()
			s.hits(1, 3, 2)
			s.endRound()
			s.advance(tc.afterGong)

			err := s.try(Event{Type: HitUndone, Actor: judge(1)})
			if err != tc.want {
				t.Fatalf("undo: got %v, want %v", err, tc.want)
			}
			want := Score{3, 2}
			if tc.want == nil {
				want = Score{3, 1} // the last tap was Blue
			}
			s.wantTotal(1, want)
		})
	}
}

func TestSpec_S11_OfflineHitsCountByDeviceTime(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.advance(10_000)
	madeAt := s.now
	s.advance(20_000)
	s.endRound()
	s.advance(5_000)

	// Four taps made during the round arrive after the gong from the offline queue.
	for i := range 4 {
		s.must(Event{Type: Hit, Actor: judge(1), Corner: Red, Offline: true, ClientTime: madeAt + int64(i)*1000})
	}
	// A queued tap made during the rest is refused.
	s.reject(Event{Type: Hit, Actor: judge(1), Corner: Red, Offline: true, ClientTime: s.now - 1000}, ErrClockNotRunning)
	// Resending the same action is not counted twice.
	first := s.f.Events[len(s.f.Events)-4]
	if _, err := Apply(s.f, first); err != ErrDuplicate {
		t.Fatalf("resend: got %v, want ErrDuplicate", err)
	}
	s.wantTotal(1, Score{4, 0})
}

func TestSpec_S13_UndoneWarningIsForgotten(t *testing.T) {
	s := newScript(t, FightConfig{})
	s.startRound()
	s.hits(1, 10, 10)
	s.referee(OfficialWarning, Red)
	s.referee(OfficialWarning, Red)
	mistake := s.f.Events[len(s.f.Events)-1].ID
	s.must(Event{Type: RefereeActionUndone, TargetID: mistake})

	c := s.view().Corners[Red]
	if c.Warnings != 1 || c.MinusPoints != 0 || c.Penalty != 0 {
		t.Fatalf("red corner = %+v, want 1 warning and no penalty", c)
	}
	s.wantTotal(1, Score{10, 10})

	// The next warning is the 2nd again and costs a minus point.
	s.referee(OfficialWarning, Red)
	s.wantTotal(1, Score{7, 10})

	// Both events stay in the log.
	if n := len(s.view().Actions); n != 3 {
		t.Fatalf("actions = %d, want 3 (undone ones are kept)", n)
	}
}

func TestSpec_S16_GongGrace(t *testing.T) {
	cases := []struct {
		name  string
		delay int64
		want  error
	}{
		{"0.3s after gong counts", 300, nil},
		{"1s after gong is refused", 1000, ErrClockNotRunning},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := newScript(t, FightConfig{})
			s.startRound()
			s.endRound()
			s.advance(tc.delay)
			if err := s.try(Event{Type: Hit, Actor: judge(2), Corner: Blue}); err != tc.want {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
}

func TestSpec_S18_NeverBlueByDefault(t *testing.T) {
	s := newScript(t, FightConfig{})
	// Every judge has equal totals. Judges 1 and 2 have Red ahead in round 3;
	// judge 3 is tied there too and decides for Blue.
	s.playRounds([]card{
		{{5, 3}, {5, 3}, {4, 4}},
		{{3, 6}, {3, 6}, {4, 4}},
		{{4, 3}, {4, 3}, {4, 4}},
	}, nil)

	for seat := 1; seat <= JudgeCount; seat++ {
		if tot := s.view().Judges[seat-1].Total; tot.Red != tot.Blue {
			t.Fatalf("judge %d total %+v, want a tie", seat, tot)
		}
	}
	if r := s.view().Result; r.Final || r.Winner != "" {
		t.Fatalf("result before judge 3 decides = %+v, want not final", r)
	}
	s.must(Event{Type: JudgeDecision, Actor: judge(3), Corner: Blue})
	s.wantResult(Red, PTS, "2:1")
}
