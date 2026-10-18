package app

import (
	"encoding/json"
	mrand "math/rand"
	"testing"
	"time"

	"judging-server/internal/clock"
	"judging-server/internal/store"
	"judging-server/internal/tournament"
	"judging-server/internal/ws"
)

// newTestApp runs an app on a fake clock with its own data directory.
func newTestApp(t *testing.T) (*App, *clock.Fake, string) {
	t.Helper()
	dir := t.TempDir()
	clk := clock.NewFake(time.UnixMilli(1_700_000_000_000))
	return openApp(t, dir, clk), clk, dir
}

func openApp(t *testing.T, dir string, clk clock.Clock) *App {
	t.Helper()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	a, err := New(Options{Store: st, Clock: clk, Rand: mrand.New(mrand.NewSource(1))})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Close)
	return a
}

func (a *App) act(typ string, payload any) error {
	b, _ := json.Marshal(payload)
	return a.Do(ws.Action{Type: typ, Payload: b})
}

// connectJudges marks all three seats as connected without real sockets.
func (a *App) connectJudges() { a.ring.SetSeats([4]bool{false, true, true, true}) }

func (a *App) state() tournament.State {
	a.tmu.Lock()
	defer a.tmu.Unlock()
	b, _ := json.Marshal(a.tournament)
	var s tournament.State
	json.Unmarshal(b, &s)
	return s
}

func (a *App) match(catID string, i int) tournament.Match {
	return a.state().Brackets[catID].Matches[i]
}

// twoFighterBracket creates a category with two fighters and its bracket.
func twoFighterBracket(t *testing.T, a *App, format map[string]any) (catID string, m tournament.Match) {
	t.Helper()
	cat := map[string]any{"name": "-60kg"}
	for k, v := range format {
		cat[k] = v
	}
	if err := a.act("ADD_CATEGORY", cat); err != nil {
		t.Fatal(err)
	}
	catID = a.state().Categories[0].ID
	a.act("ADD_FIGHTER", map[string]any{"category_id": catID, "fighter": map[string]string{"name": "Red Fighter"}})
	a.act("ADD_FIGHTER", map[string]any{"category_id": catID, "fighter": map[string]string{"name": "Blue Fighter"}})
	if err := a.act("GENERATE_BRACKET", map[string]string{"category_id": catID}); err != nil {
		t.Fatal(err)
	}
	return catID, a.match(catID, 0)
}

func startMatch(t *testing.T, a *App, catID string, m tournament.Match) {
	t.Helper()
	if err := a.act("START_BRACKET_MATCH", map[string]string{"category_id": catID, "match_id": m.ID}); err != nil {
		t.Fatal(err)
	}
	if got := a.match(catID, 0).Status; got != tournament.Active {
		t.Fatalf("bracket match status = %s, want ACTIVE", got)
	}
}

func actionOf(typ string, payload any) ws.Action {
	b, _ := json.Marshal(payload)
	return ws.Action{Type: typ, Payload: b}
}
