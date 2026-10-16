package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"sync"
	"time"

	"judging-server/internal/match"
	"judging-server/internal/ring"
	"judging-server/internal/ws"
)

// standaloneFormat is the format of fights started with NEW_FIGHT (not from a bracket).
var standaloneFormat = match.FightConfig{}.WithDefaults()

// showLiveScores lets the viewer show judges' scores during the fight (§7).
const showLiveScores = true

func nowMs() int64 { return time.Now().UnixMilli() }

func newID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

type stateUpdate struct {
	match.FightView
	LiveScores bool `json:"live_scores"`
}

// stateMessage is the STATE_UPDATE frame for the current fight.
func stateMessage(r *ring.Ring) []byte {
	broadcastMu.Lock()
	defer broadcastMu.Unlock()
	return stateMessageLocked(r)
}

func stateMessageLocked(r *ring.Ring) []byte {
	stateSeq++
	b, err := json.Marshal(ServerMessage{
		Type:       "STATE_UPDATE",
		Payload:    stateUpdate{FightView: r.View(), LiveScores: showLiveScores},
		ServerTime: nowMs(),
		Seq:        stateSeq,
	})
	if err != nil {
		log.Printf("marshal state: %v", err)
	}
	return b
}

// broadcastMu keeps state frames in the order they were computed, and stateSeq
// numbers them, so a client never replaces a newer view with an older one.
var (
	broadcastMu sync.Mutex
	stateSeq    int64
)

func BroadcastState(hub *ws.Hub) { broadcastState(hub, theRing) }

func broadcastState(hub *ws.Hub, r *ring.Ring) {
	broadcastMu.Lock()
	defer broadcastMu.Unlock()
	hub.Broadcast(stateMessageLocked(r))
}

// Payloads of fight actions.
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
}

// actionToEvent turns a client action into a fight event; the ring stamps the time.
func actionToEvent(msg ClientMessage) (match.Event, error) {
	typ, ok := fightEventTypes[msg.Type]
	if !ok {
		return match.Event{}, fmt.Errorf("unknown action %q", msg.Type)
	}
	var p fightPayload
	if len(msg.Payload) > 0 {
		if err := json.Unmarshal(msg.Payload, &p); err != nil {
			return match.Event{}, fmt.Errorf("%s payload: %w", msg.Type, err)
		}
	}
	id := msg.ID
	if id == "" {
		id = newID("e-")
	}
	e := match.Event{
		ID:         id,
		ClientTime: msg.ClientTime,
		Offline:    msg.Offline,
		Type:       typ,
		Actor:      match.Actor{Kind: match.Operator},
		Corner:     p.Corner,
		Method:     p.Method,
		TargetID:   p.TargetID,
	}
	switch typ {
	case match.Hit, match.HitUndone, match.JudgeDecision:
		e.Actor = match.Actor{Kind: match.Judge, Seat: p.seat()}
	}
	return e, nil
}

func processFightAction(hub *ws.Hub, msg ClientMessage) error {
	if msg.Type == "NEW_FIGHT" {
		var p fightPayload
		if len(msg.Payload) > 0 {
			json.Unmarshal(msg.Payload, &p)
		}
		if p.RoundSeconds > 0 {
			standaloneFormat = match.FightConfig{Rounds: p.Rounds, RoundSeconds: p.RoundSeconds, RestSeconds: p.RestSeconds}.WithDefaults()
		}
		old, err := theRing.NewFight(newID("f-"), standaloneFormat)
		if err != nil {
			log.Printf("NEW_FIGHT: %v", err)
			return err
		}
		releaseBracketMatch(hub, old)
		return nil
	}

	e, err := actionToEvent(msg)
	if err != nil {
		log.Printf("action rejected: %v", err)
		return errRejected
	}
	// The fight starts only when all three judges are connected (§1).
	if e.Type == match.RoundStarted && theRing.Fight().Phase() == match.NotStarted && !theRing.AllSeatsConnected() {
		return errJudgesNotConnected
	}
	return applyEvent(msg.Type, e)
}

// processJudgeAction applies an action from the judge on seat.
func processJudgeAction(seat int, msg ClientMessage) error {
	e, err := actionToEvent(msg)
	if err != nil {
		return errRejected
	}
	e.Actor = match.Actor{Kind: match.Judge, Seat: seat}
	// A tap queued during another fight must not count in this one.
	var p fightPayload
	json.Unmarshal(msg.Payload, &p)
	if p.FightID != "" && p.FightID != theRing.Fight().Config.FightID {
		return errWrongFight
	}
	return applyEvent(msg.Type, e)
}

// applyEvent applies e to the ring; a repeated action ID is not an error.
func applyEvent(action string, e match.Event) error {
	err := theRing.Apply(e)
	if errors.Is(err, match.ErrDuplicate) {
		return nil
	}
	if err != nil {
		log.Printf("%s rejected: %v", action, err)
	}
	return err
}

// releaseBracketMatch puts the bracket match of a fight that was replaced
// before it finished back to PENDING.
func releaseBracketMatch(hub *ws.Hub, old match.Fight) {
	if old.Config.Bracket == nil || old.Result().Final {
		return
	}
	ReleaseBracketMatch(hub, *old.Config.Bracket)
}
