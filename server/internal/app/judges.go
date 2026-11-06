package app

import (
	"encoding/json"
	"log"

	"judging-server/internal/access"
	"judging-server/internal/ring"
	"judging-server/internal/ws"
)

// loadJudgePasswords reads the judges' seat passwords from the data directory.
func (a *App) loadJudgePasswords() error {
	var p access.Passwords
	if _, err := a.store.LoadJudgePasswords(&p); err != nil {
		return err
	}
	a.amu.Lock()
	a.passwords = p
	a.amu.Unlock()
	return nil
}

// JudgeAllowed implements ws.Handler: does password open the seat?
func (a *App) JudgeAllowed(seat int, password string) bool {
	a.amu.Lock()
	defer a.amu.Unlock()
	return a.passwords.Check(seat, password)
}

type judgePasswordPayload struct {
	Seat     int    `json:"seat"`
	Password string `json:"password"`
}

// setJudgePassword (SET_JUDGE_PASSWORD) gives a seat a new password, or opens
// it with an empty one. Devices already on the seat stay connected; the
// password is asked the next time a device connects.
func (a *App) setJudgePassword(msg ws.Action) error {
	var p judgePasswordPayload
	if err := json.Unmarshal(msg.Payload, &p); err != nil {
		return errRejected
	}
	a.amu.Lock()
	next := a.passwords
	err := next.Set(p.Seat, p.Password)
	if err == nil {
		if err = a.store.SaveJudgePasswords(next); err != nil {
			log.Printf("save judge passwords: %v", err)
			err = ring.ErrPersist
		} else {
			a.passwords = next
		}
	}
	a.amu.Unlock()
	if err != nil {
		return err
	}
	a.broadcastJudgeAccess()
	return nil
}

// judgeAccessFrame is the JUDGE_ACCESS frame: which seats need a password.
func (a *App) judgeAccessFrame() []byte {
	a.accessMu.Lock()
	defer a.accessMu.Unlock()
	return a.judgeAccessFrameLocked()
}

func (a *App) judgeAccessFrameLocked() []byte {
	a.amu.Lock()
	protected := a.passwords.Protected()
	a.amu.Unlock()
	a.accessSeq++
	b, err := json.Marshal(ws.Frame{Type: ws.TypeJudgeAccess, Payload: ws.JudgeAccessPayload{Protected: protected}, ServerTime: a.nowMs(), Seq: a.accessSeq})
	if err != nil {
		log.Printf("marshal judge access: %v", err)
	}
	return b
}

func (a *App) broadcastJudgeAccess() {
	a.accessMu.Lock()
	defer a.accessMu.Unlock()
	a.hub.Broadcast(a.judgeAccessFrameLocked())
}
