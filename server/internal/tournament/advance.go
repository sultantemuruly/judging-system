package tournament

func (b *Bracket) find(round, position int) int {
	for i, m := range b.Matches {
		if m.Round == round && m.Position == position {
			return i
		}
	}
	return -1
}

// feeder reports whether the match feeding (round, position, slot) exists
// (0 = red/even child, 1 = blue/odd child) and its winner so far.
func (b *Bracket) feeder(round, position, slot int) (exists bool, winnerID, winnerName string) {
	if round <= 1 {
		return false, "", ""
	}
	i := b.find(round-1, position*2+slot)
	if i < 0 {
		return false, "", "" // a bye-vs-bye pair that was never created
	}
	m := b.Matches[i]
	return true, m.WinnerID, m.nameOf(m.WinnerID)
}

// advanceWinner puts the winner of (round, position) into the next round and
// resolves walkovers that follow from it.
func (b *Bracket) advanceWinner(round, position int, winnerID, winnerName string) {
	next := b.find(round+1, position/2)
	if next < 0 {
		return // the final: champion decided
	}
	if position%2 == 0 {
		b.Matches[next].FighterRedID, b.Matches[next].FighterRedName = winnerID, winnerName
	} else {
		b.Matches[next].FighterBlueID, b.Matches[next].FighterBlueName = winnerID, winnerName
	}
	b.autoAdvance(round+1, position/2)
}

// autoAdvance gives a match to its only fighter when the other can never arrive.
func (b *Bracket) autoAdvance(round, position int) {
	i := b.find(round, position)
	if i < 0 {
		return
	}
	m := b.Matches[i]
	if m.Status == Completed || m.Status == Bye || m.WinnerID != "" {
		return
	}
	hasRed, hasBlue := m.FighterRedID != "", m.FighterBlueID != ""
	if hasRed && hasBlue {
		return
	}
	if !hasRed && !hasBlue {
		redExists, redWinner, redName := b.feeder(round, position, 0)
		blueExists, blueWinner, blueName := b.feeder(round, position, 1)
		if (redExists && redWinner == "") || (blueExists && blueWinner == "") {
			return // still waiting for a feeder
		}
		switch {
		case !redExists && !blueExists:
			b.Matches[i].Status = Bye
			return
		case !redExists:
			b.Matches[i].FighterBlueID, b.Matches[i].FighterBlueName = blueWinner, blueName
		case !blueExists:
			b.Matches[i].FighterRedID, b.Matches[i].FighterRedName = redWinner, redName
		}
		m = b.Matches[i]
		hasRed, hasBlue = m.FighterRedID != "", m.FighterBlueID != ""
	}
	if hasRed && !hasBlue {
		if exists, winner, _ := b.feeder(round, position, 1); !exists || (winner == "" && round == 1) {
			b.Matches[i].WinnerID, b.Matches[i].Status = m.FighterRedID, Bye
			b.advanceWinner(round, position, m.FighterRedID, m.FighterRedName)
		}
	} else if hasBlue && !hasRed {
		if exists, winner, _ := b.feeder(round, position, 0); !exists || (winner == "" && round == 1) {
			b.Matches[i].WinnerID, b.Matches[i].Status = m.FighterBlueID, Bye
			b.advanceWinner(round, position, m.FighterBlueID, m.FighterBlueName)
		}
	}
}

// refresh recomputes what follows from the matches: the lock and the placings.
func (b *Bracket) refresh() {
	b.Locked = false
	for _, m := range b.Matches {
		if m.Status == Completed {
			b.Locked = true
		}
	}
	b.Placings = b.placings()
}

// placings: final winner 1st, finalist 2nd, both semi-final losers 3rd (§8).
func (b *Bracket) placings() Placings {
	p := Placings{Third: []string{}}
	if b.TotalRounds == 0 {
		return p
	}
	if i := b.find(b.TotalRounds, 0); i >= 0 {
		final := b.Matches[i]
		if final.WinnerID != "" && (final.Status == Completed || final.Status == Bye) {
			p.First = final.WinnerID
			if final.Status == Completed {
				p.Second = final.loserID()
			}
		}
	}
	if b.TotalRounds >= 2 {
		for _, m := range b.Matches {
			if m.Round == b.TotalRounds-1 && m.Status == Completed {
				p.Third = append(p.Third, m.loserID())
			}
		}
	}
	return p
}
