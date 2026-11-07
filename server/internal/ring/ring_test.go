package ring

import (
	"errors"
	"fmt"
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

// A connected judge not heard from since the last event holds up the
// confirmation (§7); the view says which one, so the operator knows who.
func TestViewNamesJudgeAwaitingReport(t *testing.T) {
	r, c := newTestRing(t)
	r.SetSeats([match.JudgeCount + 1]bool{false, true, true, true})
	c.Advance(time.Second)
	must(t, r, match.RoundStarted)

	v := r.View()
	if v.JudgesSynced {
		t.Fatal("judges not heard from since the round started must not count as synced")
	}
	for _, j := range v.Judges {
		if !j.AwaitingReport {
			t.Fatalf("judge %d: awaiting_report = false, want true", j.Seat)
		}
	}

	c.Advance(time.Second)
	r.Heard(1)
	r.Heard(2)
	v = r.View()
	if v.Judges[0].AwaitingReport || v.Judges[1].AwaitingReport || !v.Judges[2].AwaitingReport {
		t.Fatalf("awaiting_report = %v %v %v, want false false true",
			v.Judges[0].AwaitingReport, v.Judges[1].AwaitingReport, v.Judges[2].AwaitingReport)
	}

	r.Heard(3)
	if v = r.View(); !v.JudgesSynced || v.Judges[2].AwaitingReport {
		t.Fatal("all judges heard from: want synced and nobody awaiting")
	}

	r.SetSeats([match.JudgeCount + 1]bool{false, true, true, false})
	if v = r.View(); v.Judges[2].AwaitingReport {
		t.Fatal("an offline judge is reported as offline, not awaiting")
	}
}

func offlineHit(id string, seat int, clientTime int64) match.Event {
	return match.Event{ID: id, Type: match.Hit, Corner: match.Blue, Offline: true, ClientTime: clientTime,
		Actor: match.Actor{Kind: match.Judge, Seat: seat}}
}

// Taps made while the server was down are refused, since the round is
// restored paused (§9), and the operator sees how many each judge lost.
func TestSpec_S21_TapsMadeWhileServerDownAreRefusedAndReported(t *testing.T) {
	c := clock.NewFake(time.UnixMilli(1_700_000_000_000))
	log := &memLog{}
	r := New(Options{Clock: c, OpenLog: func(string) (Log, error) { return log, nil }})
	r.NewFight("f-out", match.FightConfig{})
	must(t, r, match.RoundStarted)
	c.Advance(10 * time.Second)
	lastSeen := clock.Ms(c.Now())
	r.Close() // the server goes down

	c.Advance(5 * time.Second)
	tappedAt := clock.Ms(c.Now()) // judge 1 taps during the outage
	c.Advance(5 * time.Second)

	restored := New(Options{Clock: c})
	if err := restored.Restore(log.events, &memLog{}, lastSeen); err != nil {
		t.Fatal(err)
	}
	for range 2 { // the phone resends the same tap after a dropped NACK
		if err := restored.Apply(offlineHit("t-1", 1, tappedAt)); !errors.Is(err, match.ErrClockNotRunning) {
			t.Fatalf("tap made during the outage: %v, want clock_not_running", err)
		}
	}
	if err := restored.Apply(offlineHit("t-2", 1, tappedAt+100)); !errors.Is(err, match.ErrClockNotRunning) {
		t.Fatalf("second tap: %v", err)
	}
	j := restored.View().Judges
	if j[0].OfflineRefused != 2 || j[1].OfflineRefused != 0 {
		t.Fatalf("offline_refused = %d, %d; want 2, 0", j[0].OfflineRefused, j[1].OfflineRefused)
	}
	if j[0].Total.Blue != 0 {
		t.Fatalf("a refused tap must not score: %+v", j[0].Total)
	}
}

// Only a judge's tap from the offline queue counts as lost: a live tap
// on a paused clock is the judge's own mistake, shown on their phone only.
// A new fight starts from zero.
func TestOfflineRefusedCountsOnlyQueuedTapsOfThisFight(t *testing.T) {
	r, c := newTestRing(t)
	must(t, r, match.RoundStarted)
	c.Advance(10 * time.Second)
	must(t, r, match.ClockPaused)
	c.Advance(5 * time.Second)

	live := offlineHit("live", 2, 0)
	live.Offline = false
	if err := r.Apply(live); !errors.Is(err, match.ErrClockNotRunning) {
		t.Fatalf("live tap on a paused clock: %v", err)
	}
	if err := r.Apply(offlineHit("queued", 2, 0)); !errors.Is(err, match.ErrClockNotRunning) {
		t.Fatalf("queued tap on a paused clock: %v", err)
	}
	if got := r.View().Judges[1].OfflineRefused; got != 1 {
		t.Fatalf("offline_refused = %d, want 1 (the queued tap only)", got)
	}

	if _, err := r.NewFight("f-2", match.FightConfig{}); err != nil {
		t.Fatal(err)
	}
	if got := r.View().Judges[1].OfflineRefused; got != 0 {
		t.Fatalf("new fight: offline_refused = %d, want 0", got)
	}
}

// newCountingRing is a ring that counts its broadcasts (OnChange calls).
func newCountingRing(t *testing.T) (*Ring, *clock.Fake, *int) {
	t.Helper()
	c := clock.NewFake(time.UnixMilli(1_700_000_000_000))
	n := new(int)
	r := New(Options{Clock: c, OnChange: func() { *n++ },
		OpenLog: func(string) (Log, error) { return &memLog{}, nil }})
	if _, err := r.NewFight("f-1", match.FightConfig{}); err != nil {
		t.Fatal(err)
	}
	return r, c, n
}

// One phone checking in is broadcast even while another judge still holds
// the confirmation up, so the operator's list names the right judge (S20).
func TestOneJudgeCheckingInIsBroadcast(t *testing.T) {
	r, c, broadcasts := newCountingRing(t)
	r.SetSeats([match.JudgeCount + 1]bool{false, true, true, true})
	c.Advance(time.Second)
	must(t, r, match.RoundStarted)
	c.Advance(time.Second)

	before := *broadcasts
	r.Heard(1)
	if *broadcasts != before+1 {
		t.Fatalf("judge 1 checking in: %d broadcasts, want 1", *broadcasts-before)
	}
	if v := r.View(); v.JudgesSynced || v.Judges[0].AwaitingReport || !v.Judges[2].AwaitingReport {
		t.Fatalf("after judge 1 checks in: synced=%v awaiting=%v,%v", v.JudgesSynced, v.Judges[0].AwaitingReport, v.Judges[2].AwaitingReport)
	}

	before = *broadcasts
	r.Heard(1) // a ping that changes nothing is not broadcast
	if *broadcasts != before {
		t.Fatalf("repeated ping: %d broadcasts, want 0", *broadcasts-before)
	}
}

// A refused offline tap is broadcast, so the operator's card updates; a
// device can't make the ring keep or broadcast an unbounded number of them.
func TestOfflineRefusalIsBroadcastAndCapped(t *testing.T) {
	r, c, broadcasts := newCountingRing(t)
	must(t, r, match.RoundStarted)
	c.Advance(10 * time.Second)
	must(t, r, match.ClockPaused)
	c.Advance(time.Second)

	before := *broadcasts
	r.Apply(offlineHit("q-0", 1, 0))
	if *broadcasts != before+1 {
		t.Fatalf("refused offline tap: %d broadcasts, want 1", *broadcasts-before)
	}
	for i := 1; i < maxOfflineRefusedTracked+50; i++ {
		r.Apply(offlineHit(fmt.Sprintf("q-%d", i), 1, 0))
	}
	if got := r.View().Judges[0].OfflineRefused; got != maxOfflineRefusedTracked {
		t.Fatalf("offline_refused = %d, want capped at %d", got, maxOfflineRefusedTracked)
	}
	if got := *broadcasts - before; got != maxOfflineRefusedTracked {
		t.Fatalf("%d broadcasts, want %d (none past the cap)", got, maxOfflineRefusedTracked)
	}
}

// A tap made for a fight that is no longer on the ring is refused in the
// same step as applying it, so a fight replaced just before can't receive
// it, and it isn't shown as this fight's lost offline tap.
func TestTapForReplacedFightIsRefusedInsideTheRing(t *testing.T) {
	r, c := newTestRing(t) // fight f-1
	if _, err := r.NewFight("f-2", match.FightConfig{}); err != nil {
		t.Fatal(err)
	}
	must(t, r, match.RoundStarted)
	c.Advance(time.Second)

	if err := r.ApplyToFight("f-1", offlineHit("old", 1, 0)); !errors.Is(err, ErrWrongFight) {
		t.Fatalf("tap for the replaced fight: %v, want ErrWrongFight", err)
	}
	v := r.View()
	if v.Judges[0].Hits != 0 || v.Judges[0].OfflineRefused != 0 {
		t.Fatalf("judge 1 = %d hits, %d offline refused; want 0, 0", v.Judges[0].Hits, v.Judges[0].OfflineRefused)
	}

	if err := r.ApplyToFight("f-2", offlineHit("new", 1, 0)); err != nil {
		t.Fatalf("tap for the fight on the ring: %v", err)
	}
	if err := r.ApplyToFight("", offlineHit("any", 1, 0)); err != nil {
		t.Fatalf("tap without a fight ID: %v", err)
	}
	if got := r.View().Judges[0].Hits; got != 2 {
		t.Fatalf("hits = %d, want 2", got)
	}
}
