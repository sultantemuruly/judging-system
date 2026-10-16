package store

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"judging-server/internal/match"
)

func TestFightLogRoundTrip(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	l, err := s.StartFight("f-1")
	if err != nil {
		t.Fatal(err)
	}
	want := []match.Event{
		{ID: "a", Type: match.FightCreated, At: 1, Config: &match.FightConfig{FightID: "f-1", Rounds: 3}},
		{ID: "b", Type: match.Hit, At: 2, Actor: match.Actor{Kind: match.Judge, Seat: 2}, Corner: match.Red, Round: 1},
	}
	for _, e := range want {
		if err := l.Append(e); err != nil {
			t.Fatal(err)
		}
	}
	l.Close()

	id, got, err := s.CurrentFight()
	if err != nil || id != "f-1" || !reflect.DeepEqual(got, want) {
		t.Fatalf("CurrentFight = %q %+v %v, want f-1 %+v", id, got, err, want)
	}
}

func TestTornLastLineIsDropped(t *testing.T) {
	s, _ := Open(t.TempDir())
	l, _ := s.StartFight("f-2")
	l.Append(match.Event{ID: "a", Type: match.FightCreated})
	l.Close()
	f, _ := os.OpenFile(s.fightPath("f-2"), os.O_APPEND|os.O_WRONLY, 0)
	f.WriteString(`{"id":"b","type":"Hi`)
	f.Close()

	_, got, err := s.CurrentFight()
	if err != nil || len(got) != 1 {
		t.Fatalf("got %d events, err %v; want the 1 complete event", len(got), err)
	}
}

// A crash mid-write, a restart that keeps appending, and a second restart:
// the fight must still load with every synced event.
func TestTornLineIsCutOffBeforeAppending(t *testing.T) {
	s, _ := Open(t.TempDir())
	l, _ := s.StartFight("f-3")
	l.Append(match.Event{ID: "a", Type: match.FightCreated})
	l.Close()
	f, _ := os.OpenFile(s.fightPath("f-3"), os.O_APPEND|os.O_WRONLY, 0)
	f.WriteString(`{"id":"b","ty`)
	f.Close()

	l, err := s.StartFight("f-3")
	if err != nil {
		t.Fatal(err)
	}
	l.Append(match.Event{ID: "c", Type: match.RoundStarted})
	l.Close()

	_, got, err := s.CurrentFight()
	if err != nil || len(got) != 2 || got[0].ID != "a" || got[1].ID != "c" {
		t.Fatalf("got %+v, err %v; want events a and c", got, err)
	}
}

func TestFailedAppendLeavesLogReadable(t *testing.T) {
	s, _ := Open(t.TempDir())
	l, _ := s.StartFight("f-4")
	l.Append(match.Event{ID: "a", Type: match.FightCreated})
	l.f.Close() // every following write fails
	if err := l.Append(match.Event{ID: "b", Type: match.RoundStarted}); err == nil {
		t.Fatal("append to a closed file succeeded")
	}
	_, got, err := s.CurrentFight()
	if err != nil || len(got) != 1 {
		t.Fatalf("got %d events, err %v; want the 1 synced event", len(got), err)
	}
}

func TestNoCurrentFight(t *testing.T) {
	s, _ := Open(t.TempDir())
	id, events, err := s.CurrentFight()
	if id != "" || events != nil || err != nil {
		t.Fatalf("got %q %v %v, want nothing", id, events, err)
	}
}

func TestAtomicWriteKeepsOldFileOnFailure(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tournament.json")
	if err := WriteFileAtomic(path, []byte("old")); err != nil {
		t.Fatal(err)
	}
	// A read-only directory makes the temp file impossible to create.
	os.Chmod(dir, 0o500)
	defer os.Chmod(dir, 0o755)
	if err := WriteFileAtomic(path, []byte("new")); err == nil {
		t.Fatal("write into a read-only directory should fail")
	}
	if b, _ := os.ReadFile(path); string(b) != "old" {
		t.Fatalf("file = %q, want the old content", b)
	}
}

func TestTournamentLegacyImport(t *testing.T) {
	dir := t.TempDir()
	legacy := filepath.Join(dir, "tournament_data.json")
	os.WriteFile(legacy, []byte(`{"name":"old"}`), 0o644)
	s, _ := Open(filepath.Join(dir, "data"))

	var v struct{ Name string }
	ok, err := s.LoadTournament(&v, legacy)
	if !ok || err != nil || v.Name != "old" {
		t.Fatalf("legacy import: %v %v %+v", ok, err, v)
	}
	s.SaveTournament(struct{ Name string }{"new"})
	ok, err = s.LoadTournament(&v, legacy)
	if !ok || err != nil || v.Name != "new" {
		t.Fatalf("after save the data dir wins: %v %v %+v", ok, err, v)
	}
}

func TestHeartbeatBelongsToOneFight(t *testing.T) {
	s, _ := Open(t.TempDir())
	if s.Heartbeat("f-1") != 0 {
		t.Fatal("no heartbeat yet")
	}
	s.WriteHeartbeat("f-1", 1234)
	if got := s.Heartbeat("f-1"); got != 1234 {
		t.Fatalf("heartbeat = %d, want 1234", got)
	}
	if got := s.Heartbeat("f-2"); got != 0 {
		t.Fatalf("another fight's heartbeat = %d, want 0", got)
	}
}
