package ring

import (
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"

	"judging-server/internal/clock"
	"judging-server/internal/match"
	"judging-server/internal/store"
)

type memLog struct {
	mu     sync.Mutex
	events []match.Event
}

func (l *memLog) Append(e match.Event) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.events = append(l.events, e)
	return nil
}

func (l *memLog) Close() error { return nil }

func newTestRing(t *testing.T) (*Ring, *clock.Fake) {
	t.Helper()
	c := clock.NewFake(time.UnixMilli(1_700_000_000_000))
	r := New(Options{Clock: c, OpenLog: func(string) (Log, error) { return &memLog{}, nil }})
	if _, err := r.NewFight("f-1", match.FightConfig{}); err != nil {
		t.Fatal(err)
	}
	return r, c
}

var operator = match.Actor{Kind: match.Operator}

func must(t *testing.T, r *Ring, typ match.EventType) {
	t.Helper()
	if err := r.Apply(match.Event{ID: string(typ) + time.Now().String(), Type: typ, Actor: operator}); err != nil {
		t.Fatalf("%s: %v", typ, err)
	}
}

func TestSpec_S12_RoundEndsWithoutOperator(t *testing.T) {
	r, c := newTestRing(t)
	must(t, r, match.RoundStarted)
	c.Advance(30 * time.Second)
	must(t, r, match.ClockPaused)
	c.Advance(20 * time.Second) // paused time does not count
	must(t, r, match.ClockResumed)

	c.Advance(89 * time.Second)
	if p := r.View().Clock.Phase; p != match.Running {
		t.Fatalf("at 1:59 of running time: %s, want RUNNING", p)
	}
	// Nobody sends END_ROUND: the server ends the round at 0:00.
	c.Advance(2 * time.Second)
	v := r.View()
	if v.Clock.Phase != match.Rest || v.Clock.ElapsedMs != 120_000 {
		t.Fatalf("after 0:00: phase %s elapsed %d, want REST after exactly 120000 ms", v.Clock.Phase, v.Clock.ElapsedMs)
	}
	if v.Clock.RestEndsAt != v.Clock.RoundEndedAt+60_000 {
		t.Fatalf("rest ends at %d, want gong + 60 s", v.Clock.RestEndsAt-v.Clock.RoundEndedAt)
	}

	// The next round is started by the operator, and also ends by itself.
	c.Advance(60 * time.Second)
	must(t, r, match.RoundStarted)
	c.Advance(120 * time.Second)
	if v := r.View(); v.Clock.Phase != match.Rest || v.Clock.Round != 2 {
		t.Fatalf("round 2: %+v, want REST after round 2", v.Clock)
	}
}

// The confirmation is kept even when the bracket can't record it, and the
// operator is told instead of getting a plain ACK.
func TestConfirmReportsUnrecordedResult(t *testing.T) {
	c := clock.NewFake(time.UnixMilli(1_700_000_000_000))
	r := New(Options{
		Clock:     c,
		OpenLog:   func(string) (Log, error) { return &memLog{}, nil },
		OnDecided: func(match.Fight) error { return errors.New("bracket gone") },
	})
	if _, err := r.NewFight("f-1", match.FightConfig{}); err != nil {
		t.Fatal(err)
	}
	must(t, r, match.RoundStarted)
	if err := r.Apply(match.Event{ID: "ko", Type: match.Stoppage, Actor: operator, Corner: match.Red, Method: match.KO}); err != nil {
		t.Fatal(err)
	}
	err := r.Apply(match.Event{ID: "confirm", Type: match.ResultConfirmed, Actor: operator})
	if !errors.Is(err, ErrNotRecorded) {
		t.Fatalf("confirm: %v, want ErrNotRecorded", err)
	}
	if !r.Fight().Result().Confirmed {
		t.Fatal("the confirmation must stay accepted")
	}
}

func TestRoundAlarmIgnoresStaleDeadline(t *testing.T) {
	r, c := newTestRing(t)
	must(t, r, match.RoundStarted)
	c.Advance(100 * time.Second)
	must(t, r, match.ClockPaused)
	c.Advance(10 * time.Minute)
	if p := r.View().Clock.Phase; p != match.Paused {
		t.Fatalf("paused round ended by itself: %s", p)
	}
}

func TestSpec_S17_RecoverFromLog(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	c := clock.NewFake(time.UnixMilli(1_700_000_000_000))
	open := func(id string) (Log, error) { return st.StartFight(id) }
	r := New(Options{Clock: c, OpenLog: open})
	if _, err := r.NewFight("f-17", match.FightConfig{RedName: "A", BlueName: "B"}); err != nil {
		t.Fatal(err)
	}
	must(t, r, match.RoundStarted)
	c.Advance(130 * time.Second) // round 1 ends by itself, rest
	must(t, r, match.RoundStarted)
	c.Advance(40 * time.Second)
	judge := match.Actor{Kind: match.Judge, Seat: 1}
	for i, corner := range []match.Corner{match.Red, match.Red, match.Blue} {
		r.Apply(match.Event{ID: "tap-" + string(rune('a'+i)), Type: match.Hit, Actor: judge, Corner: corner})
		c.Advance(time.Second)
	}
	r.Apply(match.Event{ID: "warn-1", Type: match.OfficialWarning, Actor: operator, Corner: match.Blue})
	before := r.View()

	// The server dies mid-round 2 and comes back 5 minutes later.
	r.Close()
	c.Advance(5 * time.Minute)
	id, events, err := st.CurrentFight()
	if err != nil || id != "f-17" {
		t.Fatalf("current fight %q: %v", id, err)
	}
	l, _ := st.StartFight(id)
	restored := New(Options{Clock: c, OpenLog: open})
	if err := restored.Restore(events, l, 0); err != nil {
		t.Fatal(err)
	}

	after := restored.View()
	if after.Clock.Phase != match.Paused || after.Clock.Round != 2 {
		t.Fatalf("restored clock %+v, want round 2 PAUSED", after.Clock)
	}
	if !reflect.DeepEqual(after.Judges, before.Judges) || !reflect.DeepEqual(after.Corners, before.Corners) {
		t.Fatalf("score changed on restore:\n got %+v\nwant %+v", after.Judges, before.Judges)
	}
	// Running time up to the last stored event is kept: 43 s into round 2.
	if after.Clock.ElapsedMs != 43_000 {
		t.Fatalf("elapsed = %d, want 43000", after.Clock.ElapsedMs)
	}
	// The pause itself is in the log, so a second restart gives the same state.
	_, again, _ := st.CurrentFight()
	if again[len(again)-1].Type != match.ClockPaused {
		t.Fatalf("last stored event = %s, want ClockPaused", again[len(again)-1].Type)
	}
}

func TestRestoreKeepsTimeUpToHeartbeat(t *testing.T) {
	c := clock.NewFake(time.UnixMilli(1_700_000_000_000))
	log := &memLog{}
	r := New(Options{Clock: c, OpenLog: func(string) (Log, error) { return log, nil }})
	r.NewFight("f-hb", match.FightConfig{})
	must(t, r, match.RoundStarted)
	started := clock.Ms(c.Now())
	r.Close()

	cases := []struct {
		name     string
		lastSeen int64
		want     int64
	}{
		{"no heartbeat: last event", 0, 0},
		{"heartbeat 50 s in", started + 50_000, 50_000},
		{"heartbeat after 0:00 is capped", started + 500_000, 120_000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			restored := New(Options{Clock: c})
			if err := restored.Restore(log.events, &memLog{}, tc.lastSeen); err != nil {
				t.Fatal(err)
			}
			if v := restored.View().Clock; v.Phase != match.Paused || v.ElapsedMs != tc.want {
				t.Fatalf("clock %+v, want PAUSED with %d ms", v, tc.want)
			}
		})
	}
}
