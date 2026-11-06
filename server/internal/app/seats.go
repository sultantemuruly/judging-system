package app

import (
	"encoding/json"
	"net/http"

	"judging-server/internal/match"
)

// judgeSeats is what the start screen needs before a device picks a judge
// seat: which seats ask for a password, and which already have a phone on them
// (taking one disconnects that phone, so the page asks first). Mirrored by
// JudgeSeats in client/src/api/protocol.ts.
type judgeSeats struct {
	Protected [match.JudgeCount]bool `json:"protected"`
	Occupied  [match.JudgeCount]bool `json:"occupied"`
}

func (a *App) judgeSeats() judgeSeats {
	a.amu.Lock()
	protected := a.passwords.Protected()
	a.amu.Unlock()
	seats := a.ring.Seats()
	s := judgeSeats{Protected: protected}
	for i := range s.Occupied {
		s.Occupied[i] = seats[i+1]
	}
	return s
}

// ServeSeats is GET /api/seats. It is open, like the viewer's pages: it only
// says which seats are locked and taken, which viewers already see.
func (a *App) ServeSeats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(a.judgeSeats())
}
