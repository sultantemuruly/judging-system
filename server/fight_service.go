package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"sync"
	"time"

	"judging-server/internal/match"
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
func stateMessage() []byte {
	b, err := json.Marshal(ServerMessage{
		Type:       "STATE_UPDATE",
		Payload:    stateUpdate{FightView: theRing.View(), LiveScores: showLiveScores},
		ServerTime: nowMs(),
	})
	if err != nil {
		log.Printf("marshal state: %v", err)
	}
	return b
}

// broadcastMu keeps state frames in the order they were computed, so a slow
// sender can never overwrite a newer view with an older one.
var broadcastMu sync.Mutex

func BroadcastState(hub *Hub) {
	broadcastMu.Lock()
	defer broadcastMu.Unlock()
	hub.broadcast <- stateMessage()
}

// Payloads of fight actions.
type fightPayload struct {
	Seat     json.RawMessage `json:"seat"`
	Corner   match.Corner    `json:"corner"`
	Method   match.Method    `json:"method"`
	TargetID string          `json:"target_id"`
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
	e := match.Event{
		ID:       newID("e-"),
		Type:     typ,
		Actor:    match.Actor{Kind: match.Operator},
		Corner:   p.Corner,
		Method:   p.Method,
		TargetID: p.TargetID,
	}
	switch typ {
	case match.Hit, match.HitUndone, match.JudgeDecision:
		e.Actor = match.Actor{Kind: match.Judge, Seat: p.seat()}
	}
	return e, nil
}

func processFightAction(hub *Hub, msg ClientMessage) {
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
			return
		}
		releaseBracketMatch(hub, old)
		return
	}

	e, err := actionToEvent(msg)
	if err != nil {
		log.Printf("action rejected: %v", err)
		return
	}
	if err := theRing.Apply(e); err != nil {
		log.Printf("%s rejected: %v", msg.Type, err)
	}
}

// releaseBracketMatch puts the bracket match of a fight that was replaced
// before it finished back to PENDING.
func releaseBracketMatch(hub *Hub, old match.Fight) {
	if old.Config.Bracket == nil || old.Result().Final {
		return
	}
	ReleaseBracketMatch(hub, *old.Config.Bracket)
}
