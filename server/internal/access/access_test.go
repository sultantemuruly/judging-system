package access

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOpenSeatAcceptsAnything(t *testing.T) {
	var p Passwords
	if !p.Check(1, "") || !p.Check(2, "whatever") {
		t.Fatal("a seat without a password must be open")
	}
	if p.Check(0, "") || p.Check(4, "") {
		t.Fatal("seats outside 1–3 are never open")
	}
}

func TestPasswordOpensOnlyItsSeat(t *testing.T) {
	var p Passwords
	if err := p.Set(2, "4821"); err != nil {
		t.Fatal(err)
	}
	if !p.Check(2, "4821") {
		t.Fatal("right password refused")
	}
	if p.Check(2, "") || p.Check(2, "4822") {
		t.Fatal("wrong password accepted")
	}
	if !p.Check(1, "") {
		t.Fatal("other seats stay open")
	}
	if got := p.Protected(); got != [3]bool{false, true, false} {
		t.Fatalf("protected = %v", got)
	}
}

func TestEmptyPasswordOpensSeat(t *testing.T) {
	var p Passwords
	p.Set(1, "secret")
	p.Set(1, "")
	if !p.Check(1, "") || p.Protected()[0] {
		t.Fatal("clearing the password must open the seat")
	}
}

func TestSetRejectsBadInput(t *testing.T) {
	var p Passwords
	if p.Set(0, "x") != ErrBadSeat || p.Set(4, "x") != ErrBadSeat {
		t.Fatal("bad seat accepted")
	}
	if p.Set(1, strings.Repeat("x", MaxPasswordLength+1)) != ErrBadPassword {
		t.Fatal("overlong password accepted")
	}
}

func TestSavedFormHasNoPlainPassword(t *testing.T) {
	var p Passwords
	p.Set(3, "plain-secret")
	b, _ := json.Marshal(p)
	if strings.Contains(string(b), "plain-secret") {
		t.Fatal("password saved in plain text")
	}
	var back Passwords
	json.Unmarshal(b, &back)
	if !back.Check(3, "plain-secret") {
		t.Fatal("password lost in a save/load round trip")
	}
}

func TestHolderKeepsSeatThroughPasswordChanges(t *testing.T) {
	var p Passwords
	phone := "0123456789abcdef0123"
	if !p.SetHolder(1, phone) || p.SetHolder(1, phone) {
		t.Fatal("SetHolder should report only a change")
	}
	p.Set(1, "4821")
	p.Set(1, "9999")
	if !p.IsHolder(1, phone) {
		t.Fatal("a password change dropped the seat's holder")
	}
	p.Set(1, "")
	if !p.IsHolder(1, phone) {
		t.Fatal("removing the password dropped the seat's holder")
	}
	if p.IsHolder(2, phone) || p.IsHolder(1, "other-device-0000000") {
		t.Fatal("holder recognised on the wrong seat or device")
	}
}

func TestWeakDeviceIDsNeverHoldASeat(t *testing.T) {
	var p Passwords
	for _, id := range []string{"", "short", "no-storage"} {
		if p.SetHolder(1, id) || p.IsHolder(1, id) {
			t.Fatalf("device %q became a holder", id)
		}
	}
}
