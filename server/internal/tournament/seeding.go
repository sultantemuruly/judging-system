package tournament

import (
	"fmt"
	"math/rand"
	"sort"
)

func nextPowerOf2(n int) int {
	p := 1
	for p < n {
		p *= 2
	}
	return p
}

// GenerateBracket seeds the category's fighters into a new bracket (§8):
// last year's champion and runner-up in opposite halves, fighters of one club
// (then one city) as far apart as possible, byes only in round 1.
// manualSeeding, if it has one entry per slot, places fighter IDs directly
// ("" is a bye). Refused once the bracket is locked.
func (s *State) GenerateBracket(categoryID string, manualSeeding []string, rng *rand.Rand) error {
	c, err := s.category(categoryID)
	if err != nil {
		return err
	}
	if s.locked(categoryID) {
		return ErrLocked
	}
	n := len(c.Fighters)
	if n == 0 {
		return ErrNoFighters
	}
	size := nextPowerOf2(n)
	totalRounds := 0
	for p := 1; p < size; p *= 2 {
		totalRounds++
	}

	slots := make([]*Fighter, size)
	if len(manualSeeding) == size {
		for i, id := range manualSeeding {
			for j := range c.Fighters {
				if id != "" && c.Fighters[j].ID == id {
					slots[i] = &c.Fighters[j]
				}
			}
		}
	} else {
		autoSeed(slots, c.Fighters, rng)
	}

	b := &Bracket{CategoryID: categoryID, TotalRounds: totalRounds, Generated: true}
	// Round 1. A slot pair with nobody is skipped; the walkover cascade fills the next round.
	for i := 0; i < size/2; i++ {
		red, blue := slots[i*2], slots[i*2+1]
		if red == nil && blue == nil {
			continue
		}
		m := Match{ID: fmt.Sprintf("m-%s-r1-p%d", categoryID, i), Round: 1, Position: i, Status: Pending}
		if red != nil {
			m.FighterRedID, m.FighterRedName = red.ID, red.Name
		}
		if blue != nil {
			m.FighterBlueID, m.FighterBlueName = blue.ID, blue.Name
		}
		if red == nil {
			m.Status, m.WinnerID = Bye, blue.ID
		} else if blue == nil {
			m.Status, m.WinnerID = Bye, red.ID
		}
		b.Matches = append(b.Matches, m)
	}
	for round := 2; round <= totalRounds; round++ {
		for i := 0; i < size>>round; i++ {
			b.Matches = append(b.Matches, Match{ID: fmt.Sprintf("m-%s-r%d-p%d", categoryID, round, i), Round: round, Position: i, Status: Pending})
		}
	}
	for _, m := range b.Matches {
		if m.Status == Bye && m.WinnerID != "" {
			b.advanceWinner(m.Round, m.Position, m.WinnerID, m.nameOf(m.WinnerID))
		}
	}
	b.refresh()
	s.Brackets[categoryID] = b
	return nil
}

// autoSeed fills slots: real pairs first, byes in the last round-1 matches.
func autoSeed(slots []*Fighter, fighters []Fighter, rng *rand.Rand) {
	size, n := len(slots), len(fighters)
	realMatches := n - size/2
	byeMatches := size/2 - realMatches

	valid := []int{}
	for i := 0; i < realMatches; i++ {
		valid = append(valid, i*2, i*2+1)
	}
	for i := 0; i < byeMatches; i++ {
		valid = append(valid, (realMatches+i)*2) // its partner slot stays a bye
	}

	var champion, second *Fighter
	var others []*Fighter
	for i := range fighters {
		f := &fighters[i]
		switch {
		case f.IsPreviousChampion && champion == nil:
			champion = f
		case f.IsPreviousSecond && second == nil:
			second = f
		default:
			others = append(others, f)
		}
	}
	// Opposite halves only make sense for a pair; a lone medallist is seeded normally.
	if champion != nil && second != nil && len(valid) >= 2 {
		slots[valid[0]] = champion
		slots[valid[len(valid)-1]] = second
	} else {
		if champion != nil {
			others = append(others, champion)
		}
		if second != nil {
			others = append(others, second)
		}
	}
	rng.Shuffle(len(others), func(i, j int) { others[i], others[j] = others[j], others[i] })
	placeWithSeparation(slots, others, valid)
}

// placeWithSeparation puts each fighter in the free slot farthest from fighters
// of the same club (weighted 10×) and city. The most constrained fighters go
// first: clubs largest first (interleaved), then fighters with only a city,
// then everyone else.
func placeWithSeparation(slots []*Fighter, fighters []*Fighter, valid []int) {
	ordered := interleave(fighters, func(f *Fighter) string { return f.Club })
	var rest []*Fighter
	for _, f := range fighters {
		if f.Club == "" {
			rest = append(rest, f)
		}
	}
	ordered = append(ordered, interleave(rest, func(f *Fighter) string { return f.City })...)
	for _, f := range rest {
		if f.City == "" {
			ordered = append(ordered, f)
		}
	}
	for _, f := range ordered {
		best, bestScore := -1, -1
		for _, i := range valid {
			if slots[i] != nil {
				continue
			}
			if score := slotScore(slots, i, f); score > bestScore {
				best, bestScore = i, score
			}
		}
		if best >= 0 {
			slots[best] = f
		}
	}
}

// interleave groups fighters by a non-empty key, largest group first, and
// takes one from each group in turn. Fighters with an empty key are left out.
func interleave(fighters []*Fighter, key func(*Fighter) string) []*Fighter {
	groups := map[string][]*Fighter{}
	var keys []string
	for _, f := range fighters {
		k := key(f)
		if k == "" {
			continue
		}
		if _, ok := groups[k]; !ok {
			keys = append(keys, k)
		}
		groups[k] = append(groups[k], f)
	}
	sort.SliceStable(keys, func(i, j int) bool { return len(groups[keys[i]]) > len(groups[keys[j]]) })
	var out []*Fighter
	for placed := true; placed; {
		placed = false
		for _, k := range keys {
			if g := groups[k]; len(g) > 0 {
				out = append(out, g[0])
				groups[k] = g[1:]
				placed = true
			}
		}
	}
	return out
}

func slotScore(slots []*Fighter, at int, f *Fighter) int {
	minClub, minCity := len(slots)+1, len(slots)+1
	for i, o := range slots {
		if o == nil {
			continue
		}
		d := max(at-i, i-at)
		if o.Club != "" && o.Club == f.Club {
			minClub = min(minClub, d)
		}
		if o.City != "" && o.City == f.City {
			minCity = min(minCity, d)
		}
	}
	return minClub*10 + minCity
}
