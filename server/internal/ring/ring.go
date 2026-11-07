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
	Close() error
}

// ErrPersist means the event could not be written to disk. Nothing changed;
// the action can be sent again.
var ErrPersist = errors.New("server_error")

// ErrWrongFight means the action was made for another fight than the one on
// the ring, e.g. a tap queued during the previous fight. Nothing changed.
var ErrWrongFight = errors.New("wrong_fight")

// ErrNotRecorded means the result was confirmed but OnDecided failed to record it.
var ErrNotRecorded = errors.New("result_not_recorded")

type Options struct {
	Clock clock.Clock
	// OpenLog opens the log of a new fight.
	OpenLog func(fightID string) (Log, error)
	// OnChange runs after every accepted event, outside the ring's lock.
	OnChange func()
	// OnDecided runs once when a fight's result is confirmed (§7), outside the
	// lock. Its error is returned from Apply wrapped in ErrNotRecorded; the
	// confirmation itself stays accepted.
	OnDecided func(match.Fight) error
}

type Ring struct {
	opts  Options
	alarm *clock.Alarm

	mu     sync.Mutex
	closed bool
	fight  match.Fight
	log    Log
	seats  [match.JudgeCount + 1]bool
	// pending is each seat's last reported count of unconfirmed taps; a seat
	// that drops off keeps its count until its device reports again.
	pending [match.JudgeCount + 1]int
	// heard is when each seat's device last sent anything (its phone pings
	// every 3 s). A phone whose Wi-Fi just died still looks connected until
	// its socket times out, and can't report the taps it is holding (§7, S20).
	heard [match.JudgeCount + 1]int64
	// offlineRefused holds, per seat, the IDs of this fight's taps that were
	// made without a connection and then refused by the rules, e.g. made
	// while the server was down and the round is restored paused (§9). The
	// operator sees how many; IDs keep a resent tap from counting twice.
	offlineRefused [match.JudgeCount + 1]map[string]bool
}

func New(opts Options) *Ring {
	if opts.OnChange == nil {
		opts.OnChange = func() {}
	}
	if opts.OnDecided == nil {
		opts.OnDecided = func(match.Fight) error { return nil }
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
		return match.Fight{}, fmt.Errorf("%w: open log: %v", ErrPersist, err)
	}
	if err := l.Append(f.Events[0]); err != nil {
		l.Close()
		return match.Fight{}, fmt.Errorf("%w: %v", ErrPersist, err)
	}
	r.mu.Lock()
	old, oldLog := r.fight, r.log
	r.fight, r.log = f, l
	r.offlineRefused = [match.JudgeCount + 1]map[string]bool{}
	r.armLocked()
	if oldLog != nil {
		oldLog.Close()
	}
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
	r.offlineRefused = [match.JudgeCount + 1]map[string]bool{}
	r.mu.Unlock()
	if f.Phase() == match.Running {
		last := max(events[len(events)-1].At, lastSeen)
		if end, _ := f.RoundEndsAt(); last > end {
			last = end
		}
		err := r.apply("", match.Event{
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
// the log and then commits it. A rejected event changes nothing; the one
// exception is ErrNotRecorded, returned after the event was committed.
func (r *Ring) Apply(e match.Event) error {
	return r.ApplyToFight("", e)
}

// ApplyToFight is Apply for an action made for fightID: it is refused with
// ErrWrongFight unless that fight is still the one on the ring. The check
// and the apply are one step, so a fight replaced in between can't receive
// the old fight's action. An empty fightID matches any fight.
func (r *Ring) ApplyToFight(fightID string, e match.Event) error {
	if e.At == 0 {
		e.At = r.now()
	}
	return r.apply(fightID, e)
}

func (r *Ring) apply(fightID string, e match.Event) error {
	r.mu.Lock()
	if fightID != "" && fightID != r.fight.Config.FightID {
		r.mu.Unlock()
		return ErrWrongFight
	}
	wasConfirmed := r.fight.Result().Confirmed
	next, err := match.Apply(r.fight, e)
	if err != nil {
		counted := r.noteOfflineRefusalLocked(e, err)
		r.mu.Unlock()
		if counted {
			r.opts.OnChange()
		}
		return err
	}
	if r.log != nil {
		if err := r.log.Append(next.Events[len(next.Events)-1]); err != nil {
			r.mu.Unlock()
			return fmt.Errorf("%w: persist %s: %v", ErrPersist, e.Type, err)
		}
	}
	r.fight = next
	r.armLocked()
	decided := !wasConfirmed && next.Result().Confirmed
	r.mu.Unlock()

	r.opts.OnChange()
	if decided {
		if err := r.opts.OnDecided(next); err != nil {
			return fmt.Errorf("%w: %v", ErrNotRecorded, err)
		}
	}
	return nil
}

// maxOfflineRefusedTracked caps the refused offline taps counted per seat and
// fight; a real outage loses far fewer.
const maxOfflineRefusedTracked = 200

// noteOfflineRefusalLocked records a judge's tap from the offline queue that
// the rules refused, and reports whether it is newly counted.
func (r *Ring) noteOfflineRefusalLocked(e match.Event, err error) bool {
	seat := e.Actor.Seat
	if e.Type != match.Hit || !e.Offline || e.Actor.Kind != match.Judge ||
		seat < 1 || seat > match.JudgeCount || errors.Is(err, match.ErrDuplicate) {
		return false
	}
	if r.offlineRefused[seat] == nil {
		r.offlineRefused[seat] = map[string]bool{}
	}
	// Seats have no passwords, so cap what one device can make us keep and
	// broadcast; past the cap the operator still sees that taps were lost.
	if r.offlineRefused[seat][e.ID] || len(r.offlineRefused[seat]) >= maxOfflineRefusedTracked {
		return false
	}
	r.offlineRefused[seat][e.ID] = true
	return true
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
	err := r.apply("", match.Event{ID: id, Type: match.RoundEnded, Actor: match.Actor{Kind: match.System}, At: end})
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
		seat := v.Judges[i].Seat
		v.Judges[i].Connected = r.seats[seat]
		v.Judges[i].Pending = r.pending[seat]
		v.Judges[i].AwaitingReport = r.awaitingLocked(seat)
		v.Judges[i].OfflineRefused = len(r.offlineRefused[seat])
	}
	v.JudgesSynced = r.judgesSyncedLocked()
	return v
}

// SetPending records how many taps the device on seat still holds unconfirmed.
func (r *Ring) SetPending(seat, n int) {
	if seat < 1 || seat > match.JudgeCount || n < 0 {
		return
	}
	r.mu.Lock()
	changed := r.pending[seat] != n
	r.pending[seat] = n
	r.mu.Unlock()
	if changed {
		r.opts.OnChange()
	}
}

// JudgesSynced reports whether every judge is connected with nothing unsent (§7).
func (r *Ring) JudgesSynced() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.judgesSyncedLocked()
}

// judgesSyncedLocked: every judge is connected, has nothing unsent, and has
// been heard from since the fight's last event, so no tap made before the
// gong or the stoppage can still be on its way.
func (r *Ring) judgesSyncedLocked() bool {
	last := r.lastEventAtLocked()
	for seat := 1; seat <= match.JudgeCount; seat++ {
		if !r.seats[seat] || r.pending[seat] > 0 || r.heard[seat] < last {
			return false
		}
	}
	return true
}

// awaitingLocked: the device on seat is connected but hasn't been heard from
// since the fight's last event, so a tap may still be on its way.
func (r *Ring) awaitingLocked(seat int) bool {
	return r.seats[seat] && r.heard[seat] < r.lastEventAtLocked()
}

// lastEventAtLocked is the server time of the fight's last event, or 0.
func (r *Ring) lastEventAtLocked() int64 {
	if n := len(r.fight.Events); n > 0 {
		return r.fight.Events[n-1].At
	}
	return 0
}

// Heard records that the device on seat just sent something.
func (r *Ring) Heard(seat int) {
	if seat < 1 || seat > match.JudgeCount {
		return
	}
	r.mu.Lock()
	before, waited := r.judgesSyncedLocked(), r.awaitingLocked(seat)
	r.heard[seat] = r.now()
	// Broadcast when the fight becomes confirmable, and also when this one
	// phone checks in, so the operator's list of who holds things up stays
	// right while another judge still does (§7, S20).
	changed := r.judgesSyncedLocked() != before || r.awaitingLocked(seat) != waited
	r.mu.Unlock()
	if changed {
		r.opts.OnChange()
	}
}

// SetSeats records which judge seats (index 1–3) have a live device. A newly
// connected device counts as heard from.
func (r *Ring) SetSeats(seats [match.JudgeCount + 1]bool) {
	r.mu.Lock()
	changed := r.seats != seats
	now := r.now()
	for seat := 1; seat <= match.JudgeCount; seat++ {
		if seats[seat] && !r.seats[seat] {
			r.heard[seat] = now
		}
	}
	r.seats = seats
	r.mu.Unlock()
	if changed {
		r.opts.OnChange()
	}
}

// Seats reports which judge seats (index 1–3) have a live device.
func (r *Ring) Seats() [match.JudgeCount + 1]bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.seats
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
