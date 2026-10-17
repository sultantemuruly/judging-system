package app

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"judging-server/internal/clock"
	"judging-server/internal/match"
	"judging-server/internal/ring"
	"judging-server/internal/tournament"
)

func TestTiedBracketFightAdvancesMajorityNotBlue(t *testing.T) {
	a, _, _ := newTestApp(t)
	a.connectJudges()
	catID, m := twoFighterBracket(t, a, nil)
	startMatch(t, a, catID, m)

	// Three rounds; nobody taps, so every judge has to decide (§6.4).
	for range 3 {
		a.act("START_ROUND", nil)
		a.act("END_ROUND", nil)
	}
	if got := a.match(catID, 0).Status; got != tournament.Active {
		t.Fatalf("before decisions: status = %s, want ACTIVE", got)
	}
	for seat, c := range map[int]match.Corner{1: match.Red, 2: match.Blue, 3: match.Red} {
		if err := a.judgeAction(seat, actionOf("JUDGE_DECISION", map[string]any{"corner": c})); err != nil {
			t.Fatal(err)
		}
	}

	// The result is final, but the bracket waits for the operator's confirmation (§7).
	if r := a.ring.View().Result; !r.Final || r.Confirmed || r.Winner != match.Red || r.Votes != "2:1" {
		t.Fatalf("result = %+v, want Red 2:1, final and unconfirmed", r)
	}
	if got := a.match(catID, 0).Status; got != tournament.Active {
		t.Fatalf("before confirmation: status = %s, want ACTIVE", got)
	}
	if err := a.act("CONFIRM_RESULT", nil); err != nil {
		t.Fatal(err)
	}
	got := a.match(catID, 0)
	if got.Status != tournament.Completed || got.WinnerID != m.FighterRedID || got.Method != match.PTS || got.Votes != "2:1" || got.FightID == "" {
		t.Fatalf("bracket match = %+v, want COMPLETED for the Red fighter, PTS 2:1", got)
	}
	if s := a.state(); s.ActiveMatchBracketMatchID != "" || s.Brackets[catID].Placings.First != m.FighterRedID {
		t.Fatalf("state = %+v, want active match cleared and Red first", s)
	}
}

func TestOneFightOnTheRing(t *testing.T) {
	a, _, _ := newTestApp(t)
	a.connectJudges()
	catID, m := twoFighterBracket(t, a, nil)
	startMatch(t, a, catID, m)
	a.act("START_ROUND", nil)

	if err := a.act("START_BRACKET_MATCH", map[string]string{"category_id": catID, "match_id": m.ID}); !errors.Is(err, errFightInProgress) {
		t.Fatalf("second start while fighting: %v, want fight_in_progress", err)
	}
	if err := a.act("NEW_FIGHT", nil); !errors.Is(err, errFightInProgress) {
		t.Fatalf("new fight over a running bracket fight: %v, want fight_in_progress", err)
	}
	if err := a.act("CANCEL_FIGHT", nil); !errors.Is(err, errFightInProgress) {
		t.Fatalf("cancel after the start: %v, want fight_in_progress", err)
	}
	// Finish and confirm: the ring is free again.
	a.act("STOPPAGE", map[string]string{"corner": "Blue", "method": "KO"})
	if err := a.act("NEW_FIGHT", nil); !errors.Is(err, errFightInProgress) {
		t.Fatalf("new fight before confirmation: %v, want fight_in_progress", err)
	}
	a.act("CONFIRM_RESULT", nil)
	if err := a.act("NEW_FIGHT", nil); err != nil {
		t.Fatalf("new fight after confirmation: %v", err)
	}
	if got := a.match(catID, 0); got.WinnerID != m.FighterBlueID || got.Method != match.KO {
		t.Fatalf("bracket match = %+v, want Blue by KO", got)
	}
}

func TestCancelUnstartedBracketFight(t *testing.T) {
	a, _, _ := newTestApp(t)
	catID, m := twoFighterBracket(t, a, nil)
	startMatch(t, a, catID, m)
	if err := a.act("CANCEL_FIGHT", nil); err != nil {
		t.Fatal(err)
	}
	if got := a.match(catID, 0).Status; got != tournament.Pending {
		t.Fatalf("status = %s, want PENDING", got)
	}
	if a.ring.Fight().Config.Bracket != nil || a.state().ActiveMatchBracketMatchID != "" {
		t.Fatal("ring should hold a standalone fight and no active bracket match")
	}
}

func TestStandaloneFightNeverTouchesBracket(t *testing.T) {
	a, _, _ := newTestApp(t)
	a.connectJudges()
	catID, m := twoFighterBracket(t, a, nil)
	startMatch(t, a, catID, m)
	a.act("NEW_FIGHT", nil) // not started yet: allowed, the match goes back to the queue
	if got := a.match(catID, 0).Status; got != tournament.Pending {
		t.Fatalf("status = %s, want PENDING", got)
	}
	a.act("START_ROUND", nil)
	a.act("STOPPAGE", map[string]string{"corner": "Blue", "method": "KO"})
	a.act("CONFIRM_RESULT", nil)
	if got := a.match(catID, 0); got.Status != tournament.Pending || got.WinnerID != "" {
		t.Fatalf("bracket match = %+v, want untouched", got)
	}
}

func TestBracketFightUsesCategoryFormat(t *testing.T) {
	a, _, _ := newTestApp(t)
	catID, m := twoFighterBracket(t, a, map[string]any{"rounds": 2, "round_seconds": 90})
	if f := a.state().Categories[0].Format; f.Rounds != 2 || f.RoundSeconds != 90 || f.RestSeconds != 60 || f.KDLimitRound != 3 {
		t.Fatalf("format = %+v, want 2×90 s with default rest and limits", f)
	}
	startMatch(t, a, catID, m)
	if c := a.ring.View().Clock; c.Rounds != 2 || c.RoundMs != 90_000 {
		t.Fatalf("fight clock = %+v, want 2 rounds of 90 s", c)
	}
}

func TestRestartRestoresFightAndTournament(t *testing.T) {
	a, _, dir := newTestApp(t)
	a.connectJudges()
	catID, m := twoFighterBracket(t, a, nil)
	startMatch(t, a, catID, m)
	a.act("START_ROUND", nil)
	a.judgeAction(1, actionOf("REGISTER_HIT", map[string]string{"corner": "Red"}))
	a.Close()

	b := openApp(t, dir, clock.NewFake(time.UnixMilli(1_700_000_100_000)))
	v := b.ring.View()
	if v.Clock.Phase != match.Paused || v.Judges[0].Total.Red != 1 || v.Bracket == nil || v.Bracket.MatchID != m.ID {
		t.Fatalf("restored view = %+v, want the paused bracket fight with 1 red hit", v)
	}
	if s := b.state(); len(s.Categories) != 1 || s.Brackets[catID].Matches[0].Status != tournament.Active {
		t.Fatal("tournament not restored")
	}
}

func TestBracketLockedAfterFirstConfirmedFight(t *testing.T) {
	a, _, _ := newTestApp(t)
	a.connectJudges()
	catID, m := twoFighterBracket(t, a, nil)
	startMatch(t, a, catID, m)
	a.act("START_ROUND", nil)
	a.act("STOPPAGE", map[string]string{"corner": "Red", "method": "RSC"})
	a.act("CONFIRM_RESULT", nil)

	if err := a.act("GENERATE_BRACKET", map[string]string{"category_id": catID}); !errors.Is(err, tournament.ErrLocked) {
		t.Fatalf("regenerate after a fight: %v, want bracket_locked", err)
	}
	if err := a.act("ADD_FIGHTER", map[string]any{"category_id": catID, "fighter": map[string]string{"name": "Late"}}); !errors.Is(err, tournament.ErrLocked) {
		t.Fatalf("add fighter after a fight: %v, want bracket_locked", err)
	}
	if err := a.act("CORRECT_RESULT", map[string]string{"category_id": catID, "match_id": m.ID, "winner_id": m.FighterBlueID, "reason": "corners_switched"}); err != nil {
		t.Fatalf("correction of the final: %v", err)
	}
	if p := a.state().Brackets[catID].Placings; p.First != m.FighterBlueID || p.Second != m.FighterRedID {
		t.Fatalf("placings = %+v, want Blue first after the correction", p)
	}
}

func TestTournamentInfo(t *testing.T) {
	a, _, _ := newTestApp(t)
	if err := a.act("SET_TOURNAMENT_INFO", map[string]string{"name": " Club Cup ", "date": "2026-11-14"}); err != nil {
		t.Fatal(err)
	}
	if s := a.state(); s.Name != "Club Cup" || s.Date != "2026-11-14" {
		t.Fatalf("info = %q %q", s.Name, s.Date)
	}
}

// confirmedReady plays a bracket fight to a Red AB win, ready to confirm.
func confirmedReady(t *testing.T, a *App) (catID string, m tournament.Match) {
	t.Helper()
	a.connectJudges()
	catID, m = twoFighterBracket(t, a, nil)
	startMatch(t, a, catID, m)
	a.act("START_ROUND", nil)
	if err := a.act("STOPPAGE", map[string]string{"corner": "Red", "method": "AB"}); err != nil {
		t.Fatal(err)
	}
	return catID, m
}

func TestConfirmRetryRecordsResultAfterFailedSave(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	a, _, dir := newTestApp(t)
	catID, _ := confirmedReady(t, a)

	// The disk refuses the tournament file (the open fight log still works).
	os.Chmod(dir, 0o555)
	t.Cleanup(func() { os.Chmod(dir, 0o755) })
	if err := a.act("CONFIRM_RESULT", nil); !errors.Is(err, ring.ErrNotRecorded) {
		t.Fatalf("confirm with a failing disk: %v, want %v", err, ring.ErrNotRecorded)
	}
	if !a.notRecorded.Load() {
		t.Fatal("state must say the result is not recorded")
	}

	os.Chmod(dir, 0o755)
	if err := a.act("CONFIRM_RESULT", nil); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if a.notRecorded.Load() {
		t.Fatal("still flagged after a successful retry")
	}
	b := openApp(t, dir, clock.NewFake(time.UnixMilli(1_700_000_100_000)))
	if got := b.match(catID, 0).Status; got != tournament.Completed {
		t.Fatalf("after restart: match %s, want COMPLETED", got)
	}
}

func TestRestartRecordsConfirmedResultMissingFromBracket(t *testing.T) {
	a, _, dir := newTestApp(t)
	catID, m := confirmedReady(t, a)
	before, err := os.ReadFile(filepath.Join(dir, "tournament.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := a.act("CONFIRM_RESULT", nil); err != nil {
		t.Fatal(err)
	}
	a.Close()
	// Crash between the fight log and tournament.json: the bracket on disk
	// still has the match on the ring.
	if err := os.WriteFile(filepath.Join(dir, "tournament.json"), before, 0o644); err != nil {
		t.Fatal(err)
	}

	b := openApp(t, dir, clock.NewFake(time.UnixMilli(1_700_000_100_000)))
	got := b.match(catID, 0)
	if got.Status != tournament.Completed || got.WinnerID != m.FighterRedID || got.Method != match.AB {
		t.Fatalf("after restart: %+v, want COMPLETED for Red by AB", got)
	}
	if b.notRecorded.Load() {
		t.Fatal("flagged as not recorded after recording at startup")
	}
}
