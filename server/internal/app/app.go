// Package app connects the pieces: WebSocket sessions (internal/ws), the
// fight on the ring (internal/ring), the tournament (internal/tournament) and
// the data directory (internal/store). It decodes client actions, enforces who
// may send what, and broadcasts state.
package app

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	mrand "math/rand"
	"sync"
	"sync/atomic"

	"judging-server/internal/clock"
	"judging-server/internal/match"
	"judging-server/internal/ring"
	"judging-server/internal/store"
	"judging-server/internal/tournament"
	"judging-server/internal/ws"
)

// Rejection reasons of the application layer (NACK codes).
var (
	errNotAllowed         = errors.New("not_allowed")
	errRejected           = errors.New("rejected")
	errJudgesNotConnected = errors.New("judges_not_connected")
	errWrongFight         = errors.New("wrong_fight")
	errFightInProgress    = errors.New("fight_in_progress")
	errJudgesNotSynced    = errors.New("judges_not_synced")
)

// showLiveScores lets the viewer show judges' scores during the fight (§7).
const showLiveScores = true

type Options struct {
	Store *store.Store
	Clock clock.Clock
	// LegacyTournamentFile is imported once if the data directory has no tournament yet.
	LegacyTournamentFile string
	// Rand drives the seeding draw.
	Rand *mrand.Rand
}

type App struct {
	store *store.Store
	clock clock.Clock
	hub   *ws.Hub
	ring  *ring.Ring

	// tmu guards the tournament, the seeding RNG and the standalone format.
	// Lock order: tmu before the ring's lock; never take tmu inside ring callbacks' locks.
	tmu        sync.Mutex
	tournament tournament.State
	rng        *mrand.Rand
	standalone match.FightConfig
	// unsaved: the last tournament save failed, so the file on disk is behind memory.
	unsaved bool

	// notRecorded: the confirmed fight on the ring is not in the bracket on disk
	// yet. Read without tmu when building state frames.
	notRecorded atomic.Bool

	recent recentIDs

	// Frames are numbered so a client never applies an older state over a newer one.
	stateMu, tournamentMu   sync.Mutex
	stateSeq, tournamentSeq int64
}

// New loads the tournament, restores the fight that was on the ring and starts the hub.
func New(opts Options) (*App, error) {
	a := &App{store: opts.Store, clock: opts.Clock, rng: opts.Rand, standalone: match.FightConfig{}.WithDefaults()}
	if a.rng == nil {
		a.rng = mrand.New(mrand.NewSource(clock.Ms(opts.Clock.Now())))
	}
	a.hub = ws.NewHub(a, a.nowMs)
	go a.hub.Run()

	a.ring = ring.New(ring.Options{
		Clock:     opts.Clock,
		OpenLog:   func(id string) (ring.Log, error) { return opts.Store.StartFight(id) },
		OnChange:  a.broadcastState,
		OnDecided: a.fightDecided,
	})

	if err := a.loadTournament(opts.LegacyTournamentFile); err != nil {
		return nil, err
	}
	if err := a.restoreFight(); err != nil {
		return nil, err
	}
	// A crash between writing the confirmation to the fight log and saving the
	// bracket leaves the result only in the log; record it now (§7).
	if err := a.recordConfirmed(); err != nil {
		log.Printf("startup: confirmed result not recorded in the bracket: %v", err)
	}
	return a, nil
}

func (a *App) Hub() *ws.Hub { return a.hub }

// Close stops the round timer.
func (a *App) Close() { a.ring.Close() }

func (a *App) nowMs() int64 { return clock.Ms(a.clock.Now()) }

func (a *App) restoreFight() error {
	// A log that can't be read is never replaced by an empty fight: the scores
	// in it would vanish from the ring without anyone noticing.
	id, events, err := a.store.CurrentFight()
	if err != nil {
		return fmt.Errorf("read the current fight (fix or move the file named in %s/current_fight): %w", a.store.Dir(), err)
	}
	if id == "" || len(events) == 0 {
		_, err := a.ring.NewFight(newID("f-"), a.standalone)
		return err
	}
	l, err := a.store.StartFight(id)
	if err != nil {
		return err
	}
	log.Printf("restoring fight %s (%d events)", id, len(events))
	return a.ring.Restore(events, l, a.store.Heartbeat(id))
}

// Heartbeat records that the round clock is running, so a restart can restore
// the round with the time it really ran. Call it about once a second.
func (a *App) Heartbeat() {
	if id, running := a.ring.RunningFight(); running {
		if err := a.store.WriteHeartbeat(id, a.nowMs()); err != nil {
			log.Printf("heartbeat: %v", err)
		}
	}
}

func newID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

// ---- ws.Handler ----

// judgeActions are the only actions a judge's device may send.
var judgeActions = map[string]bool{"REGISTER_HIT": true, "UNDO_HIT": true, "JUDGE_DECISION": true}

// HandleAction checks who may send what, then applies the action. The seat of
// a judge action is always the seat of the connection, never the payload's.
func (a *App) HandleAction(s ws.Session, msg ws.Action) error {
	switch s.Role {
	case ws.RoleViewer:
		return errNotAllowed
	case ws.RoleJudge:
		if !judgeActions[msg.Type] {
			return errNotAllowed
		}
		return a.judgeAction(s.Seat, msg)
	}
	if judgeActions[msg.Type] {
		return errNotAllowed
	}
	// Fight events are deduplicated by the event log; other actions here,
	// remembering only the ones that succeeded.
	if _, isFightEvent := fightEventTypes[msg.Type]; isFightEvent || msg.ID == "" {
		return a.Do(msg)
	}
	if a.recent.seen(msg.ID) {
		return nil
	}
	err := a.Do(msg)
	if err == nil {
		a.recent.add(msg.ID)
	}
	return err
}

// Do applies an operator or admin action.
func (a *App) Do(msg ws.Action) error {
	if handler, ok := tournamentActions[msg.Type]; ok {
		return handler(a, msg)
	}
	return a.fightAction(msg)
}

func (a *App) Snapshot() [][]byte {
	return [][]byte{a.stateFrame(), a.tournamentFrame()}
}

func (a *App) SeatsChanged(seats [4]bool) {
	a.ring.SetSeats(seats)
}

func (a *App) QueueStatus(s ws.Session, pending int) {
	a.ring.SetPending(s.Seat, pending)
}

var _ ws.Handler = (*App)(nil)

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
