package tournament

import "judging-server/internal/match"

// MatchAt returns the bracket and the index of a bracket match.
func (s *State) MatchAt(ref match.BracketRef) (*Bracket, int, error) {
	b := s.Brackets[ref.CategoryID]
	if b == nil {
		return nil, -1, ErrNotFound
	}
	for i := range b.Matches {
		if b.Matches[i].ID == ref.MatchID {
			return b, i, nil
		}
	}
	return nil, -1, ErrNotFound
}

// StartMatch marks a match as on the ring and returns it with its category.
func (s *State) StartMatch(ref match.BracketRef) (Match, Category, error) {
	c, err := s.category(ref.CategoryID)
	if err != nil {
		return Match{}, Category{}, err
	}
	b, i, err := s.MatchAt(ref)
	if err != nil {
		return Match{}, Category{}, err
	}
	m := b.Matches[i]
	if !m.hasBoth() {
		return Match{}, Category{}, ErrMatchNotReady
	}
	if m.Status == Completed || m.Status == Bye {
		return Match{}, Category{}, ErrMatchDecided
	}
	b.Matches[i].Status = Active
	s.ActiveMatchCategoryID, s.ActiveMatchBracketMatchID = ref.CategoryID, ref.MatchID
	return b.Matches[i], *c, nil
}

// CompleteMatch records a confirmed fight result and advances the winner.
func (s *State) CompleteMatch(ref match.BracketRef, res match.Result, fightID string) error {
	b, i, err := s.MatchAt(ref)
	if err != nil {
		return err
	}
	m := b.Matches[i]
	if m.Status != Active {
		return ErrMatchDecided
	}
	var winnerID string
	switch res.Winner {
	case match.Red:
		winnerID = m.FighterRedID
	case match.Blue:
		winnerID = m.FighterBlueID
	default:
		return ErrBadWinner // never "draw", never blue by default
	}
	s.decide(b, i, winnerID, res.Method, res.Votes, fightID)
	s.clearActive(ref)
	return nil
}

// ReleaseMatch puts a match that was on the ring back to PENDING.
func (s *State) ReleaseMatch(ref match.BracketRef) {
	if b, i, err := s.MatchAt(ref); err == nil && b.Matches[i].Status == Active {
		b.Matches[i].Status = Pending
	}
	s.clearActive(ref)
}

// Walkover gives a match to winnerID without a fight: the opponent did not show (§8).
func (s *State) Walkover(ref match.BracketRef, winnerID string) error {
	b, i, err := s.MatchAt(ref)
	if err != nil {
		return err
	}
	m := b.Matches[i]
	if !m.hasBoth() {
		return ErrMatchNotReady
	}
	if m.Status != Pending {
		return ErrMatchDecided
	}
	if winnerID != m.FighterRedID && winnerID != m.FighterBlueID {
		return ErrBadWinner
	}
	s.decide(b, i, winnerID, match.WO, "", "")
	return nil
}

func (s *State) decide(b *Bracket, i int, winnerID string, method match.Method, votes, fightID string) {
	m := &b.Matches[i]
	m.WinnerID, m.Status, m.Method, m.Votes, m.FightID = winnerID, Completed, method, votes, fightID
	b.advanceWinner(m.Round, m.Position, winnerID, m.nameOf(winnerID))
	b.refresh()
}

// CorrectResult changes the winner of a completed match (§8, S14): only with a
// reason, and only while the winner's next match has not started. The bracket
// downstream is updated and the old result is kept in Corrections.
func (s *State) CorrectResult(ref match.BracketRef, winnerID, reason string, at int64) error {
	if !CorrectionReasons[reason] {
		return ErrBadReason
	}
	b, i, err := s.MatchAt(ref)
	if err != nil {
		return err
	}
	m := b.Matches[i]
	if m.Status != Completed {
		return ErrMatchNotCompleted
	}
	if winnerID != m.FighterRedID && winnerID != m.FighterBlueID {
		return ErrBadWinner
	}
	if winnerID == m.WinnerID {
		return nil
	}
	name := m.nameOf(winnerID)
	if err := b.replaceAdvanced(m.Round, m.Position, m.WinnerID, winnerID, name, false); err != nil {
		return err
	}
	b.replaceAdvanced(m.Round, m.Position, m.WinnerID, winnerID, name, true)
	b.Matches[i].Corrections = append(b.Matches[i].Corrections, Correction{At: at, OldWinnerID: m.WinnerID, NewWinnerID: winnerID, Reason: reason})
	b.Matches[i].WinnerID = winnerID
	b.refresh()
	return nil
}

// replaceAdvanced swaps oldID for newID where the old winner was carried
// forward, following walkover cascades. With apply false it only checks that
// no match on the way has started.
func (b *Bracket) replaceAdvanced(round, position int, oldID, newID, newName string, apply bool) error {
	next := b.find(round+1, position/2)
	if next < 0 {
		return nil
	}
	m := &b.Matches[next]
	if m.Status == Active || m.Status == Completed {
		return ErrNextMatchStarted
	}
	if apply {
		if position%2 == 0 && m.FighterRedID == oldID {
			m.FighterRedID, m.FighterRedName = newID, newName
		}
		if position%2 == 1 && m.FighterBlueID == oldID {
			m.FighterBlueID, m.FighterBlueName = newID, newName
		}
	}
	if m.Status == Bye && m.WinnerID == oldID {
		if apply {
			m.WinnerID = newID
		}
		return b.replaceAdvanced(m.Round, m.Position, oldID, newID, newName, apply)
	}
	return nil
}

// Swap exchanges two fighters between round-1 slots before any fight is decided.
func (s *State) Swap(categoryID, matchID1, slot1, matchID2, slot2 string) error {
	b := s.Brackets[categoryID]
	if b == nil {
		return ErrNotFound
	}
	if b.Locked {
		return ErrLocked
	}
	_, i1, err1 := s.MatchAt(match.BracketRef{CategoryID: categoryID, MatchID: matchID1})
	_, i2, err2 := s.MatchAt(match.BracketRef{CategoryID: categoryID, MatchID: matchID2})
	if err1 != nil || err2 != nil {
		return ErrNotFound
	}
	m1, m2 := &b.Matches[i1], &b.Matches[i2]
	if m1.Status == Active || m2.Status == Active {
		return ErrMatchDecided
	}
	id1, name1 := slot(m1, slot1)
	id2, name2 := slot(m2, slot2)
	setSlot(m1, slot1, id2, name2)
	setSlot(m2, slot2, id1, name1)
	return nil
}

func slot(m *Match, which string) (string, string) {
	if which == "red" {
		return m.FighterRedID, m.FighterRedName
	}
	return m.FighterBlueID, m.FighterBlueName
}

func setSlot(m *Match, which, id, name string) {
	if which == "red" {
		m.FighterRedID, m.FighterRedName = id, name
	} else {
		m.FighterBlueID, m.FighterBlueName = id, name
	}
}

func (s *State) clearActive(ref match.BracketRef) {
	if s.ActiveMatchCategoryID == ref.CategoryID && s.ActiveMatchBracketMatchID == ref.MatchID {
		s.ActiveMatchCategoryID, s.ActiveMatchBracketMatchID = "", ""
	}
}
