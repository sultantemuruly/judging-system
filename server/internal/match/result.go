package match

import "fmt"

// Result is the fight result (§7). Final means it is decided; it is never a draw.
type Result struct {
	Winner    Corner `json:"winner"`
	Method    Method `json:"method"`
	Votes     string `json:"votes,omitempty"` // "3:0" or "2:1" for PTS
	Final     bool   `json:"final"`
	Confirmed bool   `json:"confirmed"`
}

// Result is the current fight result.
func (f Fight) Result() Result { return f.result() }

func (f Fight) result() Result {
	t := f.tally()
	if t.stop != nil {
		r := *t.stop
		r.Confirmed = f.confirmed
		return r
	}
	if f.phase != Ended {
		return Result{}
	}
	var votes Score
	for seat := 1; seat <= JudgeCount; seat++ {
		c, _ := t.verdict(seat)
		if c == "" {
			return Result{} // waiting for a judge's decision
		}
		votes.add(c, 1)
	}
	winner := votes.leader() // 3 votes, 2 corners: never equal
	won, lost := votes.Red, votes.Blue
	if winner == Blue {
		won, lost = lost, won
	}
	return Result{Winner: winner, Method: PTS, Votes: fmt.Sprintf("%d:%d", won, lost), Final: true, Confirmed: f.confirmed}
}
