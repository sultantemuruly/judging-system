package main

import (
	"errors"
	"sync"

	"judging-server/internal/ring"
	"judging-server/internal/ws"
)

// ClientMessage is one client action (see internal/ws).
type ClientMessage = ws.Action

// ServerMessage is one server frame (see internal/ws).
type ServerMessage = ws.Frame

var (
	errNotAllowed         = errors.New("not_allowed")
	errRejected           = errors.New("rejected")
	errJudgesNotConnected = errors.New("judges_not_connected")
	errWrongFight         = errors.New("wrong_fight")
)

// ProcessAction routes a client action to the fight or the tournament.
func ProcessAction(hub *ws.Hub, msg ClientMessage) error {
	switch msg.Type {
	case "ADD_CATEGORY", "EDIT_CATEGORY", "DELETE_CATEGORY",
		"ADD_FIGHTER", "EDIT_FIGHTER", "DELETE_FIGHTER",
		"GENERATE_BRACKET", "START_BRACKET_MATCH",
		"SWAP_FIGHTERS", "SET_MATCH_WINNER":
		return ProcessTournamentAction(hub, msg)
	default:
		return processFightAction(hub, msg)
	}
}

// judgeActions are the only actions a judge's device may send.
var judgeActions = map[string]bool{"REGISTER_HIT": true, "UNDO_HIT": true, "JUDGE_DECISION": true}

// app connects the WebSocket hub to the ring and the tournament.
type app struct {
	hub    *ws.Hub
	ring   *ring.Ring
	recent recentIDs
}

// HandleAction checks who may send what, then applies the action. The seat of
// a judge action is always the seat of the connection, never the payload's.
func (a *app) HandleAction(s ws.Session, msg ws.Action) error {
	switch s.Role {
	case ws.RoleViewer:
		return errNotAllowed
	case ws.RoleJudge:
		if !judgeActions[msg.Type] {
			return errNotAllowed
		}
	case ws.RoleOperator:
		if judgeActions[msg.Type] {
			return errNotAllowed
		}
	}
	if s.Role == ws.RoleJudge {
		return processJudgeAction(s.Seat, msg)
	}
	// Fight events are deduplicated by the event log; other actions here,
	// remembering only the ones that succeeded.
	_, isFightEvent := fightEventTypes[msg.Type]
	if isFightEvent || msg.ID == "" {
		return ProcessAction(a.hub, msg)
	}
	if a.recent.seen(msg.ID) {
		return nil
	}
	err := ProcessAction(a.hub, msg)
	if err == nil {
		a.recent.add(msg.ID)
	}
	return err
}

func (a *app) Snapshot() [][]byte {
	return [][]byte{stateMessage(a.ring), tournamentMessage()}
}

func (a *app) SeatsChanged(seats [4]bool) {
	a.ring.SetSeats(seats)
}

// recentIDs remembers the last action IDs that are not fight events, so a
// resent action is acknowledged without being applied twice.
type recentIDs struct {
	mu    sync.Mutex
	ids   map[string]bool
	order []string
}

const recentIDLimit = 4096

func (r *recentIDs) seen(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ids[id]
}

func (r *recentIDs) add(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.ids == nil {
		r.ids = map[string]bool{}
	}
	if r.ids[id] {
		return
	}
	r.ids[id] = true
	r.order = append(r.order, id)
	if len(r.order) > recentIDLimit {
		delete(r.ids, r.order[0])
		r.order = r.order[1:]
	}
}

var _ ws.Handler = (*app)(nil)
