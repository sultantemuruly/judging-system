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

// The current fight. All changes go through applyFightEvent.
var (
	fightMu sync.Mutex
	fight   match.Fight
	// standaloneFormat is the format of fights started with NEW_FIGHT.
	standaloneFormat = match.FightConfig{}.WithDefaults()
)

// showLiveScores lets the viewer show judges' scores during the fight (§7).
const showLiveScores = true

func init() {
	startFight(match.FightConfig{RoundSeconds: standaloneFormat.RoundSeconds, RestSeconds: standaloneFormat.RestSeconds})
}

func nowMs() int64 { return time.Now().UnixMilli() }

func newID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

// startFight replaces the current fight with a new one and returns the old one.
func startFight(cfg match.FightConfig) match.Fight {
	cfg.FightID = newID("f-")
	f, err := match.Apply(match.Fight{}, match.Event{
		ID: newID("e-"), Type: match.FightCreated, Actor: match.Actor{Kind: match.Operator}, At: nowMs(), Config: &cfg,
	})
	if err != nil {
		log.Printf("create fight: %v", err)
		return fight
	}
	fightMu.Lock()
	old := fight
	fight = f
	fightMu.Unlock()
	return old
}

// stateMessage is the STATE_UPDATE frame for the current fight.
func stateMessage() []byte {
	fightMu.Lock()
	defer fightMu.Unlock()
	return fightStateLocked()
}

func fightStateLocked() []byte {
	now := nowMs()
	b, err := json.Marshal(ServerMessage{
		Type:       "STATE_UPDATE",
		Payload:    stateUpdate{FightView: fight.View(now), LiveScores: showLiveScores},
		ServerTime: now,
	})
	if err != nil {
		log.Printf("marshal state: %v", err)
	}
	return b
}

type stateUpdate struct {
	match.FightView
	LiveScores bool `json:"live_scores"`
}

func BroadcastState(hub *Hub) {
	hub.broadcast <- stateMessage()
}

// applyFightEvent applies one event and broadcasts the result. When the
// result of a bracket fight becomes final, the bracket advances.
func applyFightEvent(hub *Hub, e match.Event) error {
	fightMu.Lock()
	wasFinal := fight.Result().Final
	next, err := match.Apply(fight, e)
	if err != nil {
		fightMu.Unlock()
		return err
	}
	fight = next
	res := fight.Result()
	ref := fight.Config.Bracket
	msg := fightStateLocked()
	fightMu.Unlock()

	hub.broadcast <- msg
	if ref != nil && res.Final && !wasFinal {
		if err := CompleteBracketMatch(hub, *ref, res); err != nil {
			log.Printf("bracket: %v", err)
		}
	}
	return nil
}

// Payloads of fight actions.
type fightPayload struct {
	Seat     json.RawMessage `json:"seat"`
	Corner   match.Corner    `json:"corner"`
	Method   match.Method    `json:"method"`
	TargetID string          `json:"target_id"`
	// UPDATE_MATCH_SETTINGS
	RoundDuration int `json:"round_duration"`
	RestDuration  int `json:"rest_duration"`
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

// actionToEvent turns a client action into a fight event stamped with server time.
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
		At:       nowMs(),
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
	switch msg.Type {
	case "NEW_FIGHT":
		old := startFight(match.FightConfig{RoundSeconds: standaloneFormat.RoundSeconds, RestSeconds: standaloneFormat.RestSeconds})
		releaseBracketMatch(hub, old)
		BroadcastState(hub)
		return
	case "UPDATE_MATCH_SETTINGS":
		var p fightPayload
		if err := json.Unmarshal(msg.Payload, &p); err != nil || p.RoundDuration <= 0 || p.RestDuration <= 0 {
			log.Printf("UPDATE_MATCH_SETTINGS: bad payload")
			return
		}
		standaloneFormat.RoundSeconds, standaloneFormat.RestSeconds = p.RoundDuration, p.RestDuration
		fightMu.Lock()
		fresh := fight.Phase() == match.NotStarted && fight.Config.Bracket == nil
		fightMu.Unlock()
		if fresh {
			startFight(match.FightConfig{RoundSeconds: p.RoundDuration, RestSeconds: p.RestDuration})
		}
		BroadcastState(hub)
		return
	}

	e, err := actionToEvent(msg)
	if err != nil {
		log.Printf("action rejected: %v", err)
		return
	}
	if err := applyFightEvent(hub, e); err != nil {
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
