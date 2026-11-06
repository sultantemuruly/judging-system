package clock

import (
	"testing"
	"time"
)

func TestFakeFiresInOrderAtTheirTime(t *testing.T) {
	c := NewFake(time.UnixMilli(0))
	var fired []int64
	c.AfterFunc(3*time.Second, func() { fired = append(fired, Ms(c.Now())) })
	c.AfterFunc(1*time.Second, func() { fired = append(fired, Ms(c.Now())) })
	stopped := c.AfterFunc(2*time.Second, func() { t.Fatal("stopped timer fired") })
	stopped.Stop()

	c.Advance(5 * time.Second)
	if len(fired) != 2 || fired[0] != 1000 || fired[1] != 3000 {
		t.Fatalf("fired at %v, want [1000 3000]", fired)
	}
	if Ms(c.Now()) != 5000 {
		t.Fatalf("now = %d, want 5000", Ms(c.Now()))
	}
}

func TestAlarmReplacesPreviousTime(t *testing.T) {
	c := NewFake(time.UnixMilli(0))
	a := NewAlarm(c)
	var got []string
	a.Set(1000, func() { got = append(got, "first") })
	a.Set(2000, func() { got = append(got, "second") })
	c.Advance(1500 * time.Millisecond)
	if len(got) != 0 {
		t.Fatalf("replaced alarm fired: %v", got)
	}
	c.Advance(time.Second)
	if len(got) != 1 || got[0] != "second" {
		t.Fatalf("got %v, want [second]", got)
	}
	a.Set(4000, func() { got = append(got, "third") })
	a.Set(0, nil)
	c.Advance(5 * time.Second)
	if len(got) != 1 {
		t.Fatalf("disarmed alarm fired: %v", got)
	}
}
