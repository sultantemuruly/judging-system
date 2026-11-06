package app

import (
	"encoding/json"
	"strings"
	"testing"

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
	if !b.JudgeAllowed(1, "4821") || b.JudgeAllowed(1, "") {
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
