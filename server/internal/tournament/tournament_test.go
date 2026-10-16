package tournament

import (
	"errors"
	"fmt"
	"math/rand"
	"slices"
	"testing"

	"judging-server/internal/match"
)

// newCategory builds a state with one category and the given fighters.
func newCategory(t *testing.T, fighters ...Fighter) *State {
	t.Helper()
	s := &State{}
	s.Normalize()
	if err := s.AddCategory(Category{ID: "c", Name: "-60kg"}); err != nil {
		t.Fatal(err)
	}
	for i, f := range fighters {
		if f.ID == "" {
			f.ID = fmt.Sprintf("f%d", i+1)
		}
		if f.Name == "" {
			f.Name = "Fighter " + f.ID
		}
		if err := s.AddFighter("c", f); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func plain(n int) []Fighter {
	out := make([]Fighter, n)
	for i := range out {
		out[i] = Fighter{ID: fmt.Sprintf("f%d", i+1)}
	}
	return out
}

func generate(t *testing.T, s *State, seed int64) *Bracket {
	t.Helper()
	if err := s.GenerateBracket("c", nil, rand.New(rand.NewSource(seed))); err != nil {
		t.Fatal(err)
	}
	return s.Brackets["c"]
}

// slotOf returns the round-1 slot index (0..size-1) of a fighter.
func slotOf(b *Bracket, id string) int {
	for _, m := range b.Matches {
		if m.Round != 1 {
			continue
		}
		if m.FighterRedID == id {
			return m.Position * 2
		}
		if m.FighterBlueID == id {
			return m.Position*2 + 1
		}
	}
	return -1
}

func size(b *Bracket) int { return 1 << b.TotalRounds }

func ref(id string) match.BracketRef { return match.BracketRef{CategoryID: "c", MatchID: id} }

func matchAt(b *Bracket, round, pos int) Match { return b.Matches[b.find(round, pos)] }

// win decides a pending match by a confirmed fight result.
func win(t *testing.T, s *State, m Match, corner match.Corner) {
	t.Helper()
	if _, _, err := s.StartMatch(ref(m.ID)); err != nil {
		t.Fatalf("start %s: %v", m.ID, err)
	}
	if err := s.CompleteMatch(ref(m.ID), match.Result{Winner: corner, Method: match.PTS, Votes: "3:0", Final: true, Confirmed: true}, "fight-"+m.ID); err != nil {
		t.Fatalf("complete %s: %v", m.ID, err)
	}
}

// ---- Existing seeding and advancement behaviour ----

func TestSeedingChampionAndRunnerUpInOppositeHalves(t *testing.T) {
	for n := 2; n <= 16; n++ {
		for seed := range int64(20) {
			fs := plain(n)
			fs[0].IsPreviousChampion = true
			fs[n-1].IsPreviousSecond = true
			s := newCategory(t, fs...)
			b := generate(t, s, seed)
			half := size(b) / 2
			champ, second := slotOf(b, fs[0].ID), slotOf(b, fs[n-1].ID)
			if (champ < half) == (second < half) {
				t.Fatalf("n=%d seed=%d: champion slot %d and runner-up slot %d in the same half", n, seed, champ, second)
			}
		}
	}
}

func TestSeedingSeparatesClubsThenCities(t *testing.T) {
	for seed := range int64(30) {
		fs := plain(8)
		for i := range 4 {
			fs[i].Club = "Dynamo" // 4 of 8 from one club: none meet before the semi-finals
		}
		fs[4].City, fs[5].City = "Almaty", "Almaty"
		s := newCategory(t, fs...)
		b := generate(t, s, seed)
		firstMatches := map[int]bool{}
		halves := map[int]int{}
		for i := range 4 {
			slot := slotOf(b, fs[i].ID)
			firstMatches[slot/2] = true
			halves[slot/4]++
		}
		if len(firstMatches) != 4 || halves[0] != 2 || halves[1] != 2 {
			t.Fatalf("seed %d: Dynamo fighters not spread: round-1 matches %v, halves %v", seed, firstMatches, halves)
		}
		if a, c := slotOf(b, fs[4].ID), slotOf(b, fs[5].ID); a/2 == c/2 {
			t.Fatalf("seed %d: same-city fighters meet in round 1 (slots %d, %d)", seed, a, c)
		}
	}
}

func TestByesOnlyInRoundOne(t *testing.T) {
	for n := 2; n <= 16; n++ {
		s := newCategory(t, plain(n)...)
		b := generate(t, s, int64(n))
		byes := 0
		for _, m := range b.Matches {
			if m.Status == Bye {
				if m.Round != 1 {
					t.Fatalf("n=%d: bye in round %d", n, m.Round)
				}
				byes++
			}
		}
		if byes != size(b)-n {
			t.Fatalf("n=%d: %d byes, want %d", n, byes, size(b)-n)
		}
		// Every bye winner is already waiting in round 2.
		for _, m := range b.Matches {
			if m.Status == Bye && b.TotalRounds > 1 {
				next := matchAt(b, 2, m.Position/2)
				if next.FighterRedID != m.WinnerID && next.FighterBlueID != m.WinnerID {
					t.Fatalf("n=%d: bye winner %s not advanced", n, m.WinnerID)
				}
			}
		}
	}
}

// cascadeBracket: 5 fighters in 8 slots, manually seeded so round-1 match 1 is
// empty. The winner of f1–f2 walks over round 2 straight into the final.
func cascadeBracket(t *testing.T) (*State, *Bracket) {
	t.Helper()
	s := newCategory(t, plain(5)...)
	if err := s.GenerateBracket("c", []string{"f1", "f2", "", "", "f3", "f4", "f5", ""}, rand.New(rand.NewSource(1))); err != nil {
		t.Fatal(err)
	}
	return s, s.Brackets["c"]
}

func TestManualSeedingWalkoverCascade(t *testing.T) {
	s, b := cascadeBracket(t)
	if m := matchAt(b, 2, 0); m.Status != Pending || m.FighterRedID != "" {
		t.Fatalf("round 2 before f1–f2 = %+v, want waiting", m)
	}
	if m := matchAt(b, 2, 1); m.FighterBlueID != "f5" {
		t.Fatalf("round 2 = %+v, want f5 through on a bye", m)
	}
	win(t, s, matchAt(b, 1, 0), match.Red)
	if m := matchAt(b, 2, 0); m.Status != Bye || m.WinnerID != "f1" {
		t.Fatalf("round 2 = %+v, want a walkover for f1", m)
	}
	if final := matchAt(b, 3, 0); final.FighterRedID != "f1" || final.Status != Pending {
		t.Fatalf("final = %+v, want f1 waiting in the red corner", final)
	}
}

// ---- Rules added for §8 ----

func TestFullBracketPlacings(t *testing.T) {
	s := newCategory(t, plain(8)...)
	b := generate(t, s, 7)
	for round := 1; round <= b.TotalRounds; round++ {
		for _, m := range b.Matches {
			if m.Round == round {
				win(t, s, matchAt(b, round, m.Position), match.Red)
			}
		}
	}
	p := b.Placings
	final := matchAt(b, 3, 0)
	if p.First != final.FighterRedID || p.Second != final.FighterBlueID || len(p.Third) != 2 {
		t.Fatalf("placings = %+v, final = %+v", p, final)
	}
	for _, id := range p.Third {
		if id == p.First || id == p.Second {
			t.Fatalf("3rd place %s is also a finalist", id)
		}
	}
}

func TestBracketLocksAfterFirstFight(t *testing.T) {
	s := newCategory(t, plain(5)...)
	b := generate(t, s, 1)
	if b.Locked {
		t.Fatal("byes alone must not lock the bracket")
	}
	if err := s.AddFighter("c", Fighter{ID: "f6", Name: "Late"}); err != nil {
		t.Fatalf("before any fight fighters can be added: %v", err)
	}
	b = generate(t, s, 2)
	first := slices.IndexFunc(b.Matches, func(m Match) bool { return m.Status == Pending && m.hasBoth() })
	win(t, s, b.Matches[first], match.Blue)

	if !b.Locked {
		t.Fatal("bracket must lock after the first decided fight")
	}
	rng := rand.New(rand.NewSource(3))
	for name, err := range map[string]error{
		"regenerate": s.GenerateBracket("c", nil, rng),
		"add":        s.AddFighter("c", Fighter{ID: "f9", Name: "X"}),
		"delete":     s.DeleteFighter("c", "f1"),
		"swap":       s.Swap("c", b.Matches[0].ID, "red", b.Matches[1].ID, "red"),
	} {
		if !errors.Is(err, ErrLocked) {
			t.Errorf("%s after a fight: %v, want ErrLocked", name, err)
		}
	}
	if err := s.EditFighter("c", Fighter{ID: "f1", Name: "Renamed"}); err != nil {
		t.Fatalf("editing details stays allowed: %v", err)
	}
}

// The category's first fight is on the ring: regenerating or deleting would
// leave its confirmed result nowhere to go.
func TestBracketKeptWhileMatchOnRing(t *testing.T) {
	s := newCategory(t, plain(4)...)
	b := generate(t, s, 1)
	m := matchAt(b, 1, 0)
	if _, _, err := s.StartMatch(ref(m.ID)); err != nil {
		t.Fatal(err)
	}
	if !b.Locked {
		t.Fatal("a match on the ring must lock the bracket")
	}
	if err := s.GenerateBracket("c", nil, rand.New(rand.NewSource(2))); !errors.Is(err, ErrLocked) {
		t.Errorf("regenerate: %v, want ErrLocked", err)
	}
	if err := s.DeleteCategory("c"); !errors.Is(err, ErrMatchOnRing) {
		t.Errorf("delete category: %v, want ErrMatchOnRing", err)
	}
	if err := s.CompleteMatch(ref(m.ID), match.Result{Winner: match.Red, Method: match.PTS}, "fight-1"); err != nil {
		t.Fatalf("the result still finds its match: %v", err)
	}
}

// A fight taken off the ring before it started unlocks the bracket again.
func TestReleasedMatchUnlocksBracket(t *testing.T) {
	s := newCategory(t, plain(4)...)
	b := generate(t, s, 1)
	m := matchAt(b, 1, 0)
	s.StartMatch(ref(m.ID))
	s.ReleaseMatch(ref(m.ID))
	if b.Locked {
		t.Fatal("bracket still locked after its only started match was released")
	}
}

func TestWalkoverWithoutFight(t *testing.T) {
	s := newCategory(t, plain(4)...)
	b := generate(t, s, 1)
	m := matchAt(b, 1, 0)
	if err := s.Walkover(ref(m.ID), "nobody"); !errors.Is(err, ErrBadWinner) {
		t.Fatalf("walkover to a stranger: %v", err)
	}
	if err := s.Walkover(ref(m.ID), m.FighterBlueID); err != nil {
		t.Fatal(err)
	}
	got := matchAt(b, 1, 0)
	if got.Status != Completed || got.Method != match.WO || got.WinnerID != m.FighterBlueID {
		t.Fatalf("match = %+v, want blue wins WO", got)
	}
	if matchAt(b, 2, 0).FighterRedID != m.FighterBlueID {
		t.Fatal("WO winner not advanced")
	}
	if err := s.Walkover(ref(m.ID), m.FighterRedID); !errors.Is(err, ErrMatchDecided) {
		t.Fatalf("second walkover: %v, want ErrMatchDecided", err)
	}
}

func TestResultNeverDefaultsToBlue(t *testing.T) {
	s := newCategory(t, plain(2)...)
	b := generate(t, s, 1)
	m := b.Matches[0]
	s.StartMatch(ref(m.ID))
	if err := s.CompleteMatch(ref(m.ID), match.Result{Final: true}, ""); !errors.Is(err, ErrBadWinner) {
		t.Fatalf("result without a winner: %v, want ErrBadWinner", err)
	}
	if got := b.Matches[0]; got.Status != Active || got.WinnerID != "" {
		t.Fatalf("match = %+v, want unchanged", got)
	}
}

func TestSpec_S14_CorrectionBeforeNextFight(t *testing.T) {
	s := newCategory(t, plain(4)...)
	b := generate(t, s, 1)
	m := matchAt(b, 1, 0)
	win(t, s, m, match.Red) // operator error: Blue actually won

	if err := s.CorrectResult(ref(m.ID), m.FighterBlueID, "", 1000); !errors.Is(err, ErrBadReason) {
		t.Fatalf("correction without a reason: %v", err)
	}
	if err := s.CorrectResult(ref(m.ID), m.FighterBlueID, "corners_switched", 1000); err != nil {
		t.Fatal(err)
	}
	got := matchAt(b, 1, 0)
	if got.WinnerID != m.FighterBlueID || len(got.Corrections) != 1 || got.Corrections[0].OldWinnerID != m.FighterRedID || got.Corrections[0].Reason != "corners_switched" {
		t.Fatalf("match = %+v, want blue with the old result kept", got)
	}
	if next := matchAt(b, 2, 0); next.FighterRedID != m.FighterBlueID || next.FighterRedName != m.FighterBlueName {
		t.Fatalf("final = %+v, want the corrected winner in the red slot", next)
	}
}

func TestSpec_S14_CorrectionAfterNextFightStartedRefused(t *testing.T) {
	s := newCategory(t, plain(4)...)
	b := generate(t, s, 1)
	semi1, semi2 := matchAt(b, 1, 0), matchAt(b, 1, 1)
	win(t, s, semi1, match.Red)
	win(t, s, semi2, match.Red)
	if _, _, err := s.StartMatch(ref(matchAt(b, 2, 0).ID)); err != nil {
		t.Fatal(err)
	}
	err := s.CorrectResult(ref(semi1.ID), semi1.FighterBlueID, "operator_error", 1000)
	if !errors.Is(err, ErrNextMatchStarted) {
		t.Fatalf("correction after the final started: %v, want ErrNextMatchStarted", err)
	}
	if got := matchAt(b, 1, 0); got.WinnerID != semi1.FighterRedID || len(got.Corrections) != 0 {
		t.Fatalf("match = %+v, want unchanged", got)
	}
}

func TestCorrectionFollowsWalkoverCascade(t *testing.T) {
	s, b := cascadeBracket(t)
	win(t, s, matchAt(b, 1, 0), match.Red)
	if err := s.CorrectResult(ref(matchAt(b, 1, 0).ID), "f2", "protest", 1); err != nil {
		t.Fatal(err)
	}
	if m := matchAt(b, 2, 0); m.WinnerID != "f2" {
		t.Fatalf("round 2 = %+v, want the walkover moved to f2", m)
	}
	if final := matchAt(b, 3, 0); final.FighterRedID != "f2" {
		t.Fatalf("final = %+v, want f2 after the correction", final)
	}
}
