package main

import (
	"encoding/json"
	"testing"
	"time"

	"judging-server/internal/clock"
)

// testHub runs a hub whose broadcasts go nowhere, and isolates the test from
// any tournament file in the working directory.
func testHub(t *testing.T) *Hub {
	t.Helper()
	t.Chdir(t.TempDir())
	hub, err := setup("data", clock.NewFake(time.UnixMilli(1_700_000_000_000)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(theRing.Close)
	return hub
}

func act(hub *Hub, typ string, payload any) {
	b, _ := json.Marshal(payload)
	ProcessAction(hub, ClientMessage{Type: typ, Payload: b})
}

// startTwoFighterBracket creates a category with two fighters and starts its only match.
func startTwoFighterBracket(t *testing.T, hub *Hub) (catID string, m BracketMatch) {
	t.Helper()
	act(hub, "ADD_CATEGORY", map[string]string{"name": "-60kg"})
	catID = tournamentState.Categories[0].ID
	act(hub, "ADD_FIGHTER", map[string]any{"category_id": catID, "fighter": map[string]string{"name": "Red Fighter"}})
	act(hub, "ADD_FIGHTER", map[string]any{"category_id": catID, "fighter": map[string]string{"name": "Blue Fighter"}})
	act(hub, "GENERATE_BRACKET", map[string]string{"category_id": catID})
	m = tournamentState.Brackets[catID].Matches[0]
	act(hub, "START_BRACKET_MATCH", map[string]string{"category_id": catID, "match_id": m.ID})
	if got := tournamentState.Brackets[catID].Matches[0].Status; got != BracketMatchActive {
		t.Fatalf("bracket match status = %s, want ACTIVE", got)
	}
	return catID, m
}

func TestTiedBracketFightAdvancesMajorityNotBlue(t *testing.T) {
	hub := testHub(t)
	catID, m := startTwoFighterBracket(t, hub)

	// Three rounds; nobody taps, so every judge has to decide (§6.4).
	for range 3 {
		act(hub, "START_ROUND", nil)
		act(hub, "END_ROUND", nil)
	}
	if got := tournamentState.Brackets[catID].Matches[0].Status; got != BracketMatchActive {
		t.Fatalf("before decisions: status = %s, want ACTIVE", got)
	}

	act(hub, "JUDGE_DECISION", map[string]any{"seat": 1, "corner": "Red"})
	act(hub, "JUDGE_DECISION", map[string]any{"seat": 2, "corner": "Blue"})
	act(hub, "JUDGE_DECISION", map[string]any{"seat": "3", "corner": "Red"})

	got := tournamentState.Brackets[catID].Matches[0]
	if got.Status != BracketMatchCompleted || got.WinnerID != m.FighterRedID {
		t.Fatalf("bracket match = %+v, want COMPLETED with the Red fighter", got)
	}
	if tournamentState.ActiveMatchBracketMatchID != "" {
		t.Fatal("active match should be cleared")
	}
}

func TestNewFightReleasesUnfinishedBracketMatch(t *testing.T) {
	hub := testHub(t)
	catID, _ := startTwoFighterBracket(t, hub)
	act(hub, "START_ROUND", nil)

	act(hub, "NEW_FIGHT", nil)
	if got := tournamentState.Brackets[catID].Matches[0].Status; got != BracketMatchPending {
		t.Fatalf("status = %s, want PENDING", got)
	}

	// The standalone fight must not touch the bracket when it ends.
	act(hub, "START_ROUND", nil)
	act(hub, "STOPPAGE", map[string]string{"corner": "Blue", "method": "KO"})
	if got := tournamentState.Brackets[catID].Matches[0]; got.Status != BracketMatchPending || got.WinnerID != "" {
		t.Fatalf("bracket match = %+v, want untouched", got)
	}
}

func TestBracketFightUsesCategoryFormat(t *testing.T) {
	hub := testHub(t)
	act(hub, "ADD_CATEGORY", map[string]any{"name": "U14", "rounds": 2, "round_seconds": 90})
	catID := tournamentState.Categories[0].ID
	if f := tournamentState.Categories[0].Format; f.Rounds != 2 || f.RoundSeconds != 90 || f.RestSeconds != 60 || f.KDLimitRound != 3 {
		t.Fatalf("format = %+v, want 2×90 s with default rest and limits", f)
	}
	act(hub, "ADD_FIGHTER", map[string]any{"category_id": catID, "fighter": map[string]string{"name": "A"}})
	act(hub, "ADD_FIGHTER", map[string]any{"category_id": catID, "fighter": map[string]string{"name": "B"}})
	act(hub, "GENERATE_BRACKET", map[string]string{"category_id": catID})
	m := tournamentState.Brackets[catID].Matches[0]
	act(hub, "START_BRACKET_MATCH", map[string]string{"category_id": catID, "match_id": m.ID})

	if c := theRing.View().Clock; c.Rounds != 2 || c.RoundMs != 90_000 {
		t.Fatalf("fight clock = %+v, want 2 rounds of 90 s", c)
	}
}

func TestRestartRestoresFightAndTournament(t *testing.T) {
	hub := testHub(t)
	catID, _ := startTwoFighterBracket(t, hub)
	act(hub, "START_ROUND", nil)
	act(hub, "REGISTER_HIT", map[string]any{"seat": 1, "corner": "Red"})
	theRing.Close()

	if _, err := setup("data", clock.NewFake(time.UnixMilli(1_700_000_100_000))); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(theRing.Close)
	v := theRing.View()
	if v.Clock.Phase != "PAUSED" || v.Judges[0].Total.Red != 1 || v.Bracket == nil || v.Bracket.CategoryID != catID {
		t.Fatalf("restored view = %+v, want the paused bracket fight with 1 red hit", v)
	}
	if len(tournamentState.Categories) != 1 || tournamentState.Brackets[catID] == nil {
		t.Fatal("tournament not restored")
	}
}
