package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"

	"judging-server/internal/match"
	"judging-server/internal/ws"
)

type stateUpdate struct {
	match.FightView
	LiveScores bool `json:"live_scores"`
}

// stateFrame is the STATE_UPDATE frame for the current fight.
func (a *App) stateFrame() []byte {
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	return a.stateFrameLocked()
}

func (a *App) stateFrameLocked() []byte {
	a.stateSeq++
	b, err := json.Marshal(ws.Frame{
		Type:       "STATE_UPDATE",
		Payload:    stateUpdate{FightView: a.ring.View(), LiveScores: showLiveScores},
		ServerTime: a.nowMs(),
		Seq:        a.stateSeq,
	})
	if err != nil {
		log.Printf("marshal state: %v", err)
	}
	return b
}

// broadcastState sends the fight view to everyone, in the order views are computed.
func (a *App) broadcastState() {
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	a.hub.Broadcast(a.stateFrameLocked())
}

// Payload fields of fight actions.
type fightPayload struct {
	Seat     json.RawMessage `json:"seat"`
	Corner   match.Corner    `json:"corner"`
	Method   match.Method    `json:"method"`
	TargetID string          `json:"target_id"`
	FightID  string          `json:"fight_id"`
	// NEW_FIGHT
	Rounds       int `json:"rounds"`
	RoundSeconds int `json:"round_seconds"`
	RestSeconds  int `json:"rest_seconds"`
}

// seat accepts 1 or "1".
func (p fightPayload) seat() int {
	var n int
	if json.Unmarshal(p.Seat, &n) == nil {
		return n
	}
	var s string
	if json.Unmarshal(p.Seat, &s) == nil {
		n, _ = strconv.Atoi(s)
	}
	return n
}

var fightEventTypes = map[string]match.EventType{
	"START_ROUND":         match.RoundStarted,
	"PAUSE_ROUND":         match.ClockPaused,
	"RESUME_ROUND":        match.ClockResumed,
	"END_ROUND":           match.RoundEnded,
	"REGISTER_HIT":        match.Hit,
	"UNDO_HIT":            match.HitUndone,
	"OFFICIAL_WARNING":    match.OfficialWarning,
	"MINUS_POINT":         match.MinusPoint,
	"KNOCKDOWN":           match.Knockdown,
	"STOPPAGE":            match.Stoppage,
	"UNDO_REFEREE_ACTION": match.RefereeActionUndone,
	"JUDGE_DECISION":      match.JudgeDecision,
	"CONFIRM_RESULT":      match.ResultConfirmed,
	"MEDICAL_START":       match.MedicalTimeoutStarted,
	"MEDICAL_STOP":        match.MedicalTimeoutStopped,
}

func decodeFightPayload(msg ws.Action) (fightPayload, error) {
	var p fightPayload
	if len(msg.Payload) > 0 && string(msg.Payload) != "null" {
		if err := json.Unmarshal(msg.Payload, &p); err != nil {
			return p, fmt.Errorf("%s payload: %w", msg.Type, err)
		}
	}
	return p, nil
}

// actionToEvent turns a client action into a fight event; the ring stamps the
// time. The client's action ID becomes the event ID, which deduplicates resends.
func actionToEvent(msg ws.Action) (match.Event, fightPayload, error) {
	typ, ok := fightEventTypes[msg.Type]
	if !ok {
		return match.Event{}, fightPayload{}, fmt.Errorf("unknown action %q", msg.Type)
	}
	p, err := decodeFightPayload(msg)
	if err != nil {
		return match.Event{}, p, err
	}
	id := msg.ID
	if id == "" {
		id = newID("e-")
	}
	e := match.Event{
		ID:         id,
		Type:       typ,
		Actor:      match.Actor{Kind: match.Operator},
		Corner:     p.Corner,
		Method:     p.Method,
		TargetID:   p.TargetID,
		ClientTime: msg.ClientTime,
		Offline:    msg.Offline,
	}
	if typ == match.Hit || typ == match.HitUndone || typ == match.JudgeDecision {
		e.Actor = match.Actor{Kind: match.Judge, Seat: p.seat()}
	}
	return e, p, nil
}

// inProgress: a fight that started and whose result is not confirmed yet
// occupies the ring (§8: one fight at a time).
func inProgress(f match.Fight) bool {
	return f.Phase() != match.NotStarted && !f.Result().Confirmed
}

func (a *App) fightAction(msg ws.Action) error {
	switch msg.Type {
	case "NEW_FIGHT":
		return a.newStandaloneFight(msg)
	case "CANCEL_FIGHT":
		return a.cancelFight()
	}
	e, _, err := actionToEvent(msg)
	if err != nil {
		log.Printf("action rejected: %v", err)
		return errRejected
	}
	// The fight starts only when all three judges are connected (§1).
	if e.Type == match.RoundStarted && a.ring.Fight().Phase() == match.NotStarted && !a.ring.AllSeatsConnected() {
		return errJudgesNotConnected
	}
	return a.applyEvent(msg.Type, e)
}

// judgeAction applies an action from the judge on seat.
func (a *App) judgeAction(seat int, msg ws.Action) error {
	e, p, err := actionToEvent(msg)
	if err != nil {
		return errRejected
	}
	e.Actor = match.Actor{Kind: match.Judge, Seat: seat}
	// A tap queued during another fight must not count in this one.
	if p.FightID != "" && p.FightID != a.ring.Fight().Config.FightID {
		return errWrongFight
	}
	return a.applyEvent(msg.Type, e)
}

// applyEvent applies e to the ring; a repeated action ID is not an error.
func (a *App) applyEvent(action string, e match.Event) error {
	err := a.ring.Apply(e)
	if errors.Is(err, match.ErrDuplicate) {
		return nil
	}
	if err != nil {
		log.Printf("%s rejected: %v", action, err)
	}
	return err
}

// newStandaloneFight replaces the fight on the ring with a fight outside the
// bracket. A bracket fight that started must be finished and confirmed first.
func (a *App) newStandaloneFight(msg ws.Action) error {
	p, err := decodeFightPayload(msg)
	if err != nil {
		return errRejected
	}
	a.tmu.Lock()
	cur := a.ring.Fight()
	if cur.Config.Bracket != nil && inProgress(cur) {
		a.tmu.Unlock()
		return errFightInProgress
	}
	if p.RoundSeconds > 0 {
		a.standalone = match.FightConfig{Rounds: p.Rounds, RoundSeconds: p.RoundSeconds, RestSeconds: p.RestSeconds}.WithDefaults()
	}
	return a.replaceFightLocked()
}

// replaceFightLocked puts a new standalone fight on the ring, releasing the
// old one's bracket match. Caller holds tmu; it is released here.
func (a *App) replaceFightLocked() error {
	old, err := a.ring.NewFight(newID("f-"), a.standalone)
	released := err == nil && a.releaseLocked(old)
	a.tmu.Unlock()
	if released {
		a.broadcastTournament()
	}
	return err
}

// cancelFight takes a bracket fight that has not started off the ring; its
// match goes back to the queue.
func (a *App) cancelFight() error {
	a.tmu.Lock()
	cur := a.ring.Fight()
	if cur.Phase() != match.NotStarted {
		a.tmu.Unlock()
		return errFightInProgress
	}
	if cur.Config.Bracket == nil {
		a.tmu.Unlock()
		return nil
	}
	return a.replaceFightLocked()
}
