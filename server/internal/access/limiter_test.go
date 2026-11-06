package access

import (
	"testing"
	"time"
)

func TestLockoutAfterTooManyFailures(t *testing.T) {
	var l Limiter
	now := time.Unix(1000, 0)
	for i := 1; i < MaxFailures; i++ {
		if d := l.Fail("seat1", now); d != 0 {
			t.Fatalf("locked after %d failures", i)
		}
	}
	if d := l.Fail("seat1", now); d != LockoutBase {
		t.Fatalf("lockout = %v, want %v", d, LockoutBase)
	}
	if l.LockedFor("seat1", now.Add(LockoutBase-time.Second)) == 0 {
		t.Fatal("not locked during the lockout")
	}
	if l.LockedFor("seat1", now.Add(LockoutBase)) != 0 {
		t.Fatal("still locked after the lockout")
	}
	if l.LockedFor("seat2", now) != 0 {
		t.Fatal("another key locked")
	}
}

func TestLockoutDoublesAndIsCapped(t *testing.T) {
	var l Limiter
	now := time.Unix(1000, 0)
	var last time.Duration
	for range 10 {
		for range MaxFailures {
			if d := l.Fail("k", now); d != 0 {
				last = d
			}
		}
	}
	if last != LockoutMax {
		t.Fatalf("lockout after many rounds = %v, want cap %v", last, LockoutMax)
	}
}

func TestSuccessResets(t *testing.T) {
	var l Limiter
	now := time.Unix(1000, 0)
	for range MaxFailures {
		l.Fail("k", now)
	}
	l.Succeed("k")
	if l.LockedFor("k", now) != 0 {
		t.Fatal("success did not clear the lockout")
	}
	for i := 1; i < MaxFailures; i++ {
		if l.Fail("k", now) != 0 {
			t.Fatal("failure count not reset")
		}
	}
}
