package access

import "time"

// Wrong-password limits: after MaxFailures wrong tries in a row, every try is
// refused for LockoutBase, doubling with each further lockout up to LockoutMax.
const (
	MaxFailures = 5
	LockoutBase = 30 * time.Second
	LockoutMax  = 10 * time.Minute
)

// Limiter counts wrong passwords per key (a seat, or the admin account) and
// locks the key out after too many. The zero value is ready; not safe for
// concurrent use. Time is passed in, so tests are deterministic.
type Limiter struct {
	keys map[string]*limit
}

type limit struct {
	failures int
	lockouts int
	until    time.Time
}

// LockedFor is how much longer key is locked out (0 if it isn't).
func (l *Limiter) LockedFor(key string, now time.Time) time.Duration {
	if s := l.keys[key]; s != nil && now.Before(s.until) {
		return s.until.Sub(now)
	}
	return 0
}

// Fail records a wrong password. It returns the lockout it started, or 0.
func (l *Limiter) Fail(key string, now time.Time) time.Duration {
	if l.keys == nil {
		l.keys = map[string]*limit{}
	}
	s := l.keys[key]
	if s == nil {
		s = &limit{}
		l.keys[key] = s
	}
	s.failures++
	if s.failures < MaxFailures {
		return 0
	}
	d := LockoutBase << s.lockouts
	if d > LockoutMax || d <= 0 {
		d = LockoutMax
	}
	s.failures = 0
	s.lockouts++
	s.until = now.Add(d)
	return d
}

// Succeed forgets key's failures and lockouts.
func (l *Limiter) Succeed(key string) {
	delete(l.keys, key)
}
