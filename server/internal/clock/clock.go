// Package clock gives the server a replaceable notion of time, so the round
// timer can be tested by advancing a fake clock instead of sleeping.
package clock

import (
	"sort"
	"sync"
	"time"
)

type Clock interface {
	Now() time.Time
	AfterFunc(d time.Duration, f func()) Timer
}

type Timer interface {
	Stop() bool
}

// Real is the wall clock.
type Real struct{}

func (Real) Now() time.Time                            { return time.Now() }
func (Real) AfterFunc(d time.Duration, f func()) Timer { return time.AfterFunc(d, f) }

// Ms is a time as milliseconds since the Unix epoch, the unit used by the domain.
func Ms(t time.Time) int64 { return t.UnixMilli() }

// Alarm runs one callback at a set time; setting it again replaces the previous one.
type Alarm struct {
	clock Clock
	mu    sync.Mutex
	timer Timer
	at    int64
}

func NewAlarm(c Clock) *Alarm { return &Alarm{clock: c} }

// Set arms the alarm for atMs (server ms). A zero atMs disarms it.
// Setting the same time again keeps the existing timer.
func (a *Alarm) Set(atMs int64, f func()) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if atMs == a.at && a.timer != nil {
		return
	}
	if a.timer != nil {
		a.timer.Stop()
		a.timer = nil
	}
	a.at = atMs
	if atMs == 0 {
		return
	}
	d := time.Duration(atMs-Ms(a.clock.Now())) * time.Millisecond
	a.timer = a.clock.AfterFunc(max(d, 0), func() {
		a.mu.Lock()
		if a.at == atMs {
			a.at, a.timer = 0, nil
		}
		a.mu.Unlock()
		f()
	})
}

// Fake is a manual clock for tests. Timers fire during Advance, in time order.
type Fake struct {
	mu     sync.Mutex
	now    time.Time
	timers []*fakeTimer
}

type fakeTimer struct {
	fake    *Fake
	at      time.Time
	f       func()
	stopped bool
}

func NewFake(start time.Time) *Fake { return &Fake{now: start} }

func (c *Fake) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *Fake) AfterFunc(d time.Duration, f func()) Timer {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := &fakeTimer{fake: c, at: c.now.Add(d), f: f}
	c.timers = append(c.timers, t)
	return t
}

func (t *fakeTimer) Stop() bool {
	t.fake.mu.Lock()
	defer t.fake.mu.Unlock()
	was := !t.stopped
	t.stopped = true
	return was
}

// Advance moves time forward by d, firing due timers (outside the lock) at their own time.
func (c *Fake) Advance(d time.Duration) {
	c.mu.Lock()
	end := c.now.Add(d)
	c.mu.Unlock()
	for {
		c.mu.Lock()
		sort.SliceStable(c.timers, func(i, j int) bool { return c.timers[i].at.Before(c.timers[j].at) })
		var next *fakeTimer
		for i, t := range c.timers {
			if !t.stopped && !t.at.After(end) {
				next = t
				c.timers = append(c.timers[:i:i], c.timers[i+1:]...)
				break
			}
		}
		if next == nil {
			c.now = end
			c.mu.Unlock()
			return
		}
		if next.at.After(c.now) {
			c.now = next.at
		}
		next.stopped = true
		c.mu.Unlock()
		next.f()
	}
}
