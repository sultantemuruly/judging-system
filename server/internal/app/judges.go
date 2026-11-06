package app

import (
	"encoding/json"
	"fmt"
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

// JudgeAllowed implements ws.Handler. The device already on the seat gets
// back on without a password; anyone else needs the seat's password, and
// after too many wrong ones the seat refuses everyone else for a while.
func (a *App) JudgeAllowed(seat int, device, password string) (int64, bool) {
	now := a.clock.Now()
	key := fmt.Sprintf("seat-%d", seat)
	a.amu.Lock()
	defer a.amu.Unlock()
	if a.passwords.IsHolder(seat, device) {
		return 0, true
	}
	if wait := a.judgeLimits.LockedFor(key, now); wait > 0 {
		return wait.Milliseconds(), false
	}
	if !a.passwords.Check(seat, password) {
		if wait := a.judgeLimits.Fail(key, now); wait > 0 {
			log.Printf("judge seat %d: %d wrong passwords, locked for %v", seat, access.MaxFailures, wait)
			return wait.Milliseconds(), false
		}
		return 0, false
	}
	a.judgeLimits.Succeed(key)
	if a.passwords.SetHolder(seat, device) {
		// Remembered on disk, so the judge also gets back on after a restart.
		// A failed save only costs that; the judge is let on regardless.
		if err := a.store.SaveJudgePasswords(a.passwords); err != nil {
			log.Printf("save judge seat holder: %v", err)
		}
	}
	return 0, true
}

type judgePasswordPayload struct {
	Seat     int    `json:"seat"`
	Password string `json:"password"`
}

// setJudgePassword (SET_JUDGE_PASSWORD) gives a seat a new password, or opens
// it with an empty one. The device on the seat keeps it, also when it
// reconnects; any other device needs the new password.
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
