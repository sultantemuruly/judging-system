package match

import (
	"errors"
	"fmt"
	"testing"
)

// script drives a fight with a fake millisecond clock.
type script struct {
	t   *testing.T
	f   Fight
	now int64
	seq int
}

const startTime = 1_700_000_000_000

func newScript(t *testing.T, cfg FightConfig) *script {
	t.Helper()
	s := &script{t: t, now: startTime}
	if cfg.FightID == "" {
		cfg.FightID = "fight-1"
	}
	s.must(Event{Type: FightCreated, Actor: Actor{Kind: Operator}, Config: &cfg})
	return s
}

func op() Actor            { return Actor{Kind: Operator} }
func judge(seat int) Actor { return Actor{Kind: Judge, Seat: seat} }

func (s *script) advance(ms int64) { s.now += ms }

// try applies e at the current time and returns the rejection, if any.
func (s *script) try(e Event) error {
	s.t.Helper()
	s.seq++
	if e.ID == "" {
		e.ID = fmt.Sprintf("e%d", s.seq)
	}
	if e.At == 0 {
		e.At = s.now
	}
	if e.Actor.Kind == "" {
		e.Actor = op()
	}
	var err error
	s.f, err = Apply(s.f, e)
	return err
}

func (s *script) must(e Event) {
	s.t.Helper()
	if err := s.try(e); err != nil {
		s.t.Fatalf("%s rejected: %v", e.Type, err)
	}
}

func (s *script) reject(e Event, want error) {
	s.t.Helper()
	if err := s.try(e); !errors.Is(err, want) {
		s.t.Fatalf("%s: got %v, want %v", e.Type, err, want)
	}
}

func (s *script) startRound() { s.t.Helper(); s.must(Event{Type: RoundStarted}) }
func (s *script) endRound()   { s.t.Helper(); s.must(Event{Type: RoundEnded}) }

// hits taps red and blue hits for one judge, 100 ms apart.
func (s *script) hits(seat, red, blue int) {
	s.t.Helper()
	for range red {
		s.must(Event{Type: Hit, Actor: judge(seat), Corner: Red})
		s.advance(100)
	}
	for range blue {
		s.must(Event{Type: Hit, Actor: judge(seat), Corner: Blue})
		s.advance(100)
	}
}

func (s *script) referee(typ EventType, c Corner) { s.t.Helper(); s.must(Event{Type: typ, Corner: c}) }

// card is one judge's hits in one round.
type card = [JudgeCount]Score

// playRounds runs every round: start, the judges' taps, gong, rest.
// during, if set, runs inside each round after the taps.
func (s *script) playRounds(rounds []card, during func(round int)) {
	s.t.Helper()
	for i, r := range rounds {
		s.startRound()
		for seat := 1; seat <= JudgeCount; seat++ {
			s.hits(seat, r[seat-1].Red, r[seat-1].Blue)
		}
		if during != nil {
			during(i + 1)
		}
		s.advance(1000)
		s.endRound()
		s.advance(60_000)
	}
}

// totals spreads whole-fight totals over 3 rounds, all in round 1.
func totals(j1, j2, j3 Score) []card {
	return []card{{j1, j2, j3}, {}, {}}
}

func (s *script) view() FightView { return s.f.View(s.now) }

func (s *script) wantVerdict(seat int, want Corner) {
	s.t.Helper()
	if got := s.view().Judges[seat-1].Verdict; got != want {
		s.t.Fatalf("judge %d verdict = %q, want %q (total %+v)", seat, got, want, s.view().Judges[seat-1].Total)
	}
}

func (s *script) wantTotal(seat int, want Score) {
	s.t.Helper()
	if got := s.view().Judges[seat-1].Total; got != want {
		s.t.Fatalf("judge %d total = %+v, want %+v", seat, got, want)
	}
}

func (s *script) wantResult(winner Corner, method Method, votes string) {
	s.t.Helper()
	r := s.view().Result
	if !r.Final || r.Winner != winner || r.Method != method || r.Votes != votes {
		s.t.Fatalf("result = %+v, want final %s %s %q", r, winner, method, votes)
	}
}
