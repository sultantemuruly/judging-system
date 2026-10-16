// Package ring runs the fight on one ring: it applies events to the current
// fight, writes each accepted event to the log before anyone sees it, ends the
// round at 0:00 by itself, and tells listeners when something changed.
package ring

import (
	"errors"
	"fmt"
	"log"
	"sync"

	"judging-server/internal/clock"
	"judging-server/internal/match"
)

// Log is where accepted events are persisted, one fight per log.
type Log interface {
	Append(match.Event) error
}

type Options struct {
	Clock clock.Clock
	// OpenLog opens the log of a new fight.
	OpenLog func(fightID string) (Log, error)
	// OnChange runs after every accepted event, outside the ring's lock.
	OnChange func()
	// OnDecided runs once when a fight's result becomes final, outside the lock.
	OnDecided func(match.Fight)
}

type Ring struct {
	opts  Options
	alarm *clock.Alarm

	mu     sync.Mutex
	closed bool
	fight  match.Fight
	log    Log
	seats  [match.JudgeCount + 1]bool
}

func New(opts Options) *Ring {
	if opts.OnChange == nil {
		opts.OnChange = func() {}
	}
	if opts.OnDecided == nil {
		opts.OnDecided = func(match.Fight) {}
	}
	return &Ring{opts: opts, alarm: clock.NewAlarm(opts.Clock)}
}

func (r *Ring) now() int64 { return clock.Ms(r.opts.Clock.Now()) }

// NewFight replaces the current fight and returns the one it replaced.
func (r *Ring) NewFight(id string, cfg match.FightConfig) (match.Fight, error) {
	cfg.FightID = id
	e := match.Event{ID: id + "-created", Type: match.FightCreated, Actor: match.Actor{Kind: match.Operator}, At: r.now(), Config: &cfg}
	f, err := match.Apply(match.Fight{}, e)
	if err != nil {
		return match.Fight{}, err
	}
	l, err := r.opts.OpenLog(id)
	if err != nil {
		return match.Fight{}, err
	}
	if err := l.Append(f.Events[0]); err != nil {
		return match.Fight{}, err
	}
	r.mu.Lock()
	old := r.fight
	r.fight, r.log = f, l
	r.armLocked()
	r.mu.Unlock()
	r.opts.OnChange()
	return old, nil
}

// Restore rebuilds the fight from its stored events after a restart. A round
// that was running when the server stopped is restored paused (§9), keeping
// the time it ran: up to the last stored event or the last heartbeat
// (lastSeen, 0 if unknown), whichever is later, and never past 0:00.
func (r *Ring) Restore(events []match.Event, l Log, lastSeen int64) error {
	f, err := match.Replay(events)
	if err != nil {
		return err
	}
	r.mu.Lock()
	r.fight, r.log = f, l
	r.mu.Unlock()
	if f.Phase() == match.Running {
		last := max(events[len(events)-1].At, lastSeen)
		if end, _ := f.RoundEndsAt(); last > end {
			last = end
		}
		err := r.apply(match.Event{
			ID: fmt.Sprintf("sys-%s-restore-%d", f.Config.FightID, len(events)), Type: match.ClockPaused,
			Actor: match.Actor{Kind: match.System}, At: last,
		})
		if err != nil {
			return err
		}
		log.Printf("ring: fight %s restored paused in round %d", f.Config.FightID, f.CurrentRound())
	}
	r.mu.Lock()
	r.armLocked()
	r.mu.Unlock()
	return nil
}

// Apply stamps e with the server time (unless set), validates it, writes it to
// the log and then commits it. A rejected event changes nothing.
func (r *Ring) Apply(e match.Event) error {
	if e.At == 0 {
		e.At = r.now()
	}
	return r.apply(e)
}

func (r *Ring) apply(e match.Event) error {
	r.mu.Lock()
	wasFinal := r.fight.Result().Final
	next, err := match.Apply(r.fight, e)
	if err != nil {
		r.mu.Unlock()
		return err
	}
	if r.log != nil {
		if err := r.log.Append(next.Events[len(next.Events)-1]); err != nil {
			r.mu.Unlock()
			return fmt.Errorf("persist %s: %w", e.Type, err)
		}
	}
	r.fight = next
	r.armLocked()
	decided := !wasFinal && next.Result().Final
	r.mu.Unlock()

	r.opts.OnChange()
	if decided {
		r.opts.OnDecided(next)
	}
	return nil
}

// Close stops the round timer; the ring accepts no more timer events.
func (r *Ring) Close() {
	r.mu.Lock()
	r.closed = true
	r.alarm.Set(0, nil)
	r.mu.Unlock()
}

// armLocked sets the alarm for the end of the running round.
func (r *Ring) armLocked() {
	end, ok := r.fight.RoundEndsAt()
	if !ok || r.closed {
		r.alarm.Set(0, nil)
		return
	}
	id := fmt.Sprintf("sys-%s-r%d-end", r.fight.Config.FightID, r.fight.CurrentRound())
	r.alarm.Set(end, func() { r.timeUp(id, end) })
}

// timeUp ends the round at 0:00 if the clock still says so.
func (r *Ring) timeUp(id string, end int64) {
	r.mu.Lock()
	cur, ok := r.fight.RoundEndsAt()
	closed := r.closed
	r.mu.Unlock()
	if !ok || cur != end || closed {
		return // paused or changed in the meantime; the alarm was re-armed
	}
	err := r.apply(match.Event{ID: id, Type: match.RoundEnded, Actor: match.Actor{Kind: match.System}, At: end})
	if err != nil && !errors.Is(err, match.ErrDuplicate) && !errors.Is(err, match.ErrClockState) {
		log.Printf("ring: ending round: %v", err)
	}
}

// RunningFight returns the fight ID while its round clock is running.
func (r *Ring) RunningFight() (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.fight.Config.FightID, r.fight.Phase() == match.Running
}

// Fight returns a snapshot of the current fight.
func (r *Ring) Fight() match.Fight {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.fight
}

// View is the current fight view, with judge connection status.
func (r *Ring) View() match.FightView {
	r.mu.Lock()
	defer r.mu.Unlock()
	v := r.fight.View(r.now())
	for i := range v.Judges {
		v.Judges[i].Connected = r.seats[v.Judges[i].Seat]
	}
	return v
}

// SetSeatConnected records whether a judge seat has a live device.
func (r *Ring) SetSeatConnected(seat int, connected bool) {
	if seat < 1 || seat > match.JudgeCount {
		return
	}
	r.mu.Lock()
	changed := r.seats[seat] != connected
	r.seats[seat] = connected
	r.mu.Unlock()
	if changed {
		r.opts.OnChange()
	}
}

// AllSeatsConnected reports whether all three judges are connected (§1).
func (r *Ring) AllSeatsConnected() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for seat := 1; seat <= match.JudgeCount; seat++ {
		if !r.seats[seat] {
			return false
		}
	}
	return true
}
