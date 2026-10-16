package match

// Score is a pair of points for the two corners.
type Score struct {
	Red  int `json:"red"`
	Blue int `json:"blue"`
}

func (s *Score) add(c Corner, n int) {
	if c == Red {
		s.Red += n
	} else {
		s.Blue += n
	}
}

func (s Score) minus(d Score) Score { return Score{Red: s.Red - d.Red, Blue: s.Blue - d.Blue} }

// leader is the corner with more points, or "" when equal.
func (s Score) leader() Corner {
	switch {
	case s.Red > s.Blue:
		return Red
	case s.Blue > s.Red:
		return Blue
	}
	return ""
}

// tally is everything scoring needs, folded from the log with undone events skipped.
type tally struct {
	rounds    int
	hits      [JudgeCount + 1][]Score // per seat, per round
	hitCount  [JudgeCount + 1]int
	deduct    []Score // per round, points deducted at every judge
	warnings  Score
	minus     Score // minus points, from warnings and direct
	kdFight   Score
	kdRound   []Score
	decisions [JudgeCount + 1]Corner
	stop      *Result // set when a stoppage or the 4th warning ended the fight
}

func (f Fight) tally() tally {
	n := max(f.round, 1)
	t := tally{rounds: n, deduct: make([]Score, n), kdRound: make([]Score, n), decisions: f.decisions}
	for seat := 1; seat <= JudgeCount; seat++ {
		t.hits[seat] = make([]Score, n)
	}
	for _, e := range f.Events {
		if f.undone[e.ID] || e.Round < 1 || e.Round > n {
			continue
		}
		r := e.Round - 1
		switch e.Type {
		case Hit:
			t.hits[e.Actor.Seat][r].add(e.Corner, 1)
			t.hitCount[e.Actor.Seat]++
		case OfficialWarning:
			t.warnings.add(e.Corner, 1)
			w := t.warnings.Red
			if e.Corner == Blue {
				w = t.warnings.Blue
			}
			// §4: the 2nd and 3rd warning each cost a minus point; the 4th disqualifies.
			if w == 2 || w == 3 {
				t.minus.add(e.Corner, 1)
				t.deduct[r].add(e.Corner, MinusPointValue)
			}
			if w >= WarningsForDQ && t.stop == nil {
				t.stop = &Result{Winner: e.Corner.Opponent(), Method: DQ, Final: true}
			}
		case MinusPoint:
			t.minus.add(e.Corner, 1)
			t.deduct[r].add(e.Corner, MinusPointValue)
		case Knockdown:
			t.kdFight.add(e.Corner, 1)
			t.kdRound[r].add(e.Corner, 1)
			t.deduct[r].add(e.Corner, KnockdownValue)
		case Stoppage:
			if t.stop == nil {
				t.stop = &Result{Winner: e.Corner, Method: e.Method, Final: true}
			}
		}
	}
	return t
}

// judgeRounds is the seat's net score per round: hits minus deductions.
func (t tally) judgeRounds(seat int) []Score {
	out := make([]Score, t.rounds)
	for r := range out {
		out[r] = t.hits[seat][r].minus(t.deduct[r])
	}
	return out
}

func (t tally) judgeTotal(seat int) Score {
	var s Score
	for _, r := range t.judgeRounds(seat) {
		s.Red += r.Red
		s.Blue += r.Blue
	}
	return s
}

// pointsVerdict is the judge's winner by points (§6.1–6.3): the higher total,
// then the higher net score in the last round. ok is false when the judge must
// decide personally: still tied, or the judge pressed nothing at all (§6.4).
func (t tally) pointsVerdict(seat int) (Corner, bool) {
	if t.hitCount[seat] == 0 {
		return "", false
	}
	if c := t.judgeTotal(seat).leader(); c != "" {
		return c, true
	}
	rounds := t.judgeRounds(seat)
	if c := rounds[len(rounds)-1].leader(); c != "" {
		return c, true
	}
	return "", false
}

// verdict is the judge's final pick: by points, else the judge's own decision.
func (t tally) verdict(seat int) (c Corner, decided bool) {
	if c, ok := t.pointsVerdict(seat); ok {
		return c, false
	}
	return t.decisions[seat], t.decisions[seat] != ""
}
