package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"judging-server/internal/access"
	"judging-server/internal/ws"
)

func setPassword(t *testing.T, op *wsConn, id string, seat int, password string) {
	t.Helper()
	op.send(id, "SET_JUDGE_PASSWORD", judgePasswordPayload{Seat: seat, Password: password})
	if r := op.result(id); r != "" {
		t.Fatalf("set password of seat %d: %q", seat, r)
	}
}

// refused reports whether the server turned the connection away as a wrong password.
func refused(c *wsConn) bool {
	c.t.Helper()
	f := c.next("first frame", func(ws.Frame) bool { return true })
	return f.Type == ws.TypeJudgeAuthFailed
}

func TestOpenSeatNeedsNoPassword(t *testing.T) {
	url, _, _ := wsServer(t)
	if refused(dial(t, url, "role=judge&seat=1&device=a")) {
		t.Fatal("a seat without a password refused a judge")
	}
}

func TestJudgeNeedsSeatPassword(t *testing.T) {
	url, _, _ := wsServer(t)
	op := dialOperator(t, url)
	setPassword(t, op, "pw-1", 2, "4821")

	for _, q := range []string{"role=judge&seat=2&device=a", "role=judge&seat=2&device=a&password=1111"} {
		c := dial(t, url, q)
		if !refused(c) {
			t.Fatalf("%s: connected without the right password", q)
		}
		// The server closes the connection after refusing it.
		for range c.frames {
		}
	}
	if refused(dial(t, url, "role=judge&seat=2&device=a&password=4821")) {
		t.Fatal("right password refused")
	}
	if refused(dial(t, url, "role=judge&seat=1&device=b")) {
		t.Fatal("another seat's password locked seat 1")
	}
}

func TestRefusedDeviceDoesNotTakeTheSeat(t *testing.T) {
	url, _, _ := wsServer(t)
	op := dialOperator(t, url)
	setPassword(t, op, "pw-1", 1, "4821")
	judge := dial(t, url, "role=judge&seat=1&device=phone&password=4821")
	judge.waitState("judge 1 on the seat", func(s stateUpdate) bool { return len(s.Judges) == 3 && s.Judges[0].Connected })

	intruder := dial(t, url, "role=judge&seat=1&device=other")
	if !refused(intruder) {
		t.Fatal("intruder connected")
	}
	// Anything the server sent the phone before this answer would include a takeover notice.
	judge.send("", ws.TypeTimeSync, map[string]int{"client_sent": 1})
	judge.next("time sync on the original phone", func(f ws.Frame) bool {
		if f.Type == ws.TypeSessionReplaced {
			t.Fatal("a refused device took the seat")
		}
		return f.Type == ws.TypeTimeSync
	})
}

func TestJudgeAccessFrameShowsProtectedSeats(t *testing.T) {
	url, _, _ := wsServer(t)
	op := dialOperator(t, url)
	setPassword(t, op, "pw-1", 3, "x")
	// A device that connects now gets it in its first frames.
	viewer := dial(t, url, "role=viewer")
	f := viewer.next("judge access with seat 3 protected", func(f ws.Frame) bool {
		if f.Type != ws.TypeJudgeAccess {
			return false
		}
		var p ws.JudgeAccessPayload
		json.Unmarshal(f.Payload.(json.RawMessage), &p)
		return p.Protected == [3]bool{false, false, true}
	})
	if f.Seq == 0 {
		t.Fatal("judge access frame without seq")
	}

	// Clearing the password opens the seat again.
	setPassword(t, op, "pw-2", 3, "")
	if refused(dial(t, url, "role=judge&seat=3&device=a")) {
		t.Fatal("cleared seat still needs a password")
	}
}

func TestOnlyOperatorSetsPasswords(t *testing.T) {
	url, _, _ := wsServer(t)
	for _, q := range []string{"role=viewer", "role=judge&seat=1&device=a"} {
		c := dial(t, url, q)
		c.send("pw", "SET_JUDGE_PASSWORD", judgePasswordPayload{Seat: 1, Password: "x"})
		if r := c.result("pw"); r != "not_allowed" {
			t.Fatalf("%s set a password: %q", q, r)
		}
	}
}

func TestBadSeatPasswordRejected(t *testing.T) {
	url, _, _ := wsServer(t)
	op := dialOperator(t, url)
	op.send("pw", "SET_JUDGE_PASSWORD", judgePasswordPayload{Seat: 4, Password: "x"})
	if r := op.result("pw"); r != "bad_seat" {
		t.Fatalf("seat 4: %q, want bad_seat", r)
	}
}

func TestPasswordsSurviveRestart(t *testing.T) {
	a, clk, dir := newTestApp(t)
	if err := a.Do(ws.Action{ID: "pw", Type: "SET_JUDGE_PASSWORD", Payload: json.RawMessage(`{"seat":1,"password":"4821"}`)}); err != nil {
		t.Fatal(err)
	}
	a.Close()
	b := openApp(t, dir, clk)
	if _, ok := b.JudgeAllowed(1, "", "4821"); !ok {
		t.Fatal("seat password lost on restart")
	}
	if _, ok := b.JudgeAllowed(1, "", ""); ok {
		t.Fatal("seat password lost on restart")
	}
}

func TestPasswordsNotInTournamentState(t *testing.T) {
	a, _, _ := newTestApp(t)
	a.Do(ws.Action{ID: "pw", Type: "SET_JUDGE_PASSWORD", Payload: json.RawMessage(`{"seat":1,"password":"4821"}`)})
	for _, frame := range a.Snapshot() {
		var f struct {
			Payload json.RawMessage `json:"payload"`
		}
		json.Unmarshal(frame, &f)
		if s := string(f.Payload); strings.Contains(s, "4821") || strings.Contains(s, `"hash"`) || strings.Contains(s, `"salt"`) {
			t.Fatalf("a frame every device gets carries the password: %s", s)
		}
	}
}

const phoneID = "3f2a9c1e-7b4d-4e8a-9f10-2c3d4e5f6a7b"

func TestJudgeOnSeatKeepsItWhenPasswordIsSet(t *testing.T) {
	url, _, _ := wsServer(t)
	op := dialOperator(t, url)
	// The judge joins while the seat is still open...
	first := dial(t, url, "role=judge&seat=1&device="+phoneID)
	if refused(first) {
		t.Fatal("open seat refused")
	}
	first.conn.Close()
	// ...then the admin sets a password, and the phone's Wi-Fi drops.
	setPassword(t, op, "pw-1", 1, "4821")
	if refused(dial(t, url, "role=judge&seat=1&device="+phoneID)) {
		t.Fatal("the judge already on the seat was locked out on reconnect")
	}
	if !refused(dial(t, url, "role=judge&seat=1&device=a-different-phone-0000000000")) {
		t.Fatal("another device got on without the password")
	}
	setPassword(t, op, "pw-2", 1, "1111")
	if refused(dial(t, url, "role=judge&seat=1&device="+phoneID)) {
		t.Fatal("a password change locked out the judge on the seat")
	}
}

func TestSeatHolderSurvivesRestart(t *testing.T) {
	a, clk, dir := newTestApp(t)
	a.Do(ws.Action{ID: "pw", Type: "SET_JUDGE_PASSWORD", Payload: json.RawMessage(`{"seat":2,"password":"4821"}`)})
	if _, ok := a.JudgeAllowed(2, phoneID, "4821"); !ok {
		t.Fatal("right password refused")
	}
	a.Close()
	if _, ok := openApp(t, dir, clk).JudgeAllowed(2, phoneID, ""); !ok {
		t.Fatal("after a restart the judge on the seat needs the password again")
	}
}

func TestSeatLocksAfterTooManyWrongPasswords(t *testing.T) {
	a, clk, _ := newTestApp(t)
	a.Do(ws.Action{ID: "pw", Type: "SET_JUDGE_PASSWORD", Payload: json.RawMessage(`{"seat":1,"password":"4821"}`)})
	a.JudgeAllowed(1, phoneID, "4821") // the real judge is on the seat
	for i := 0; i < access.MaxFailures; i++ {
		a.JudgeAllowed(1, "guesser-device-000000000000", fmt.Sprintf("%04d", i))
	}
	wait, ok := a.JudgeAllowed(1, "guesser-device-000000000000", "4821")
	if ok || wait != access.LockoutBase.Milliseconds() {
		t.Fatalf("right password during the lockout: ok=%v wait=%d", ok, wait)
	}
	if _, ok := a.JudgeAllowed(1, phoneID, ""); !ok {
		t.Fatal("the lockout shut out the judge already on the seat")
	}
	if _, ok := a.JudgeAllowed(2, "guesser-device-000000000000", ""); !ok {
		t.Fatal("the lockout spread to another seat")
	}
	clk.Advance(access.LockoutBase)
	if _, ok := a.JudgeAllowed(1, "new-phone-00000000000000000", "4821"); !ok {
		t.Fatal("still locked after the lockout ended")
	}
}

func TestLockedSeatTellsThePhoneHowLong(t *testing.T) {
	url, _, _ := wsServer(t)
	op := dialOperator(t, url)
	setPassword(t, op, "pw", 3, "4821")
	var f ws.Frame
	for i := 0; i < access.MaxFailures; i++ {
		f = dial(t, url, "role=judge&seat=3&device=x&password=bad").next("refusal", func(ws.Frame) bool { return true })
	}
	var p ws.JudgeAuthFailedPayload
	json.Unmarshal(f.Payload.(json.RawMessage), &p)
	if f.Type != ws.TypeJudgeAuthFailed || p.RetryAfterMs <= 0 {
		t.Fatalf("lockout frame: %s %+v", f.Type, p)
	}
}

// Credentials only count in the HELLO frame; in the URL (which proxies log)
// they are ignored.
func TestCredentialsInURLAreIgnored(t *testing.T) {
	url, _, _ := wsServer(t)
	op := dialOperator(t, url)
	setPassword(t, op, "pw", 1, "4821")
	conn, _, err := websocket.DefaultDialer.Dial(url+"?role=judge&seat=1&password=4821", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.WriteJSON(ws.Action{Type: ws.TypeHello, Payload: json.RawMessage(`{"device":"x"}`)})
	var f ws.Frame
	if err := conn.ReadJSON(&f); err != nil || f.Type != ws.TypeJudgeAuthFailed {
		t.Fatalf("password in the URL opened the seat: %v %s", err, f.Type)
	}
}

func TestConnectionWithoutHelloIsDropped(t *testing.T) {
	url, _, _ := wsServer(t)
	conn, _, err := websocket.DefaultDialer.Dial(url+"?role=viewer", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.WriteJSON(ws.Action{Type: "TIME_SYNC"})
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("a connection that skipped HELLO got state")
	}
}
