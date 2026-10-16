package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"judging-server/internal/clock"
	"judging-server/internal/match"
	"judging-server/internal/ws"
)

// wsServer runs the whole server on a fake clock behind a real WebSocket endpoint.
func wsServer(t *testing.T) (url string, clk *clock.Fake) {
	t.Helper()
	t.Chdir(t.TempDir())
	clk = clock.NewFake(time.UnixMilli(1_700_000_000_000))
	hub, err := setup("data", clk)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(theRing.Close)
	srv := httptest.NewServer(httpHandler(hub))
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws", clk
}

type wsConn struct {
	t      *testing.T
	conn   *websocket.Conn
	frames chan ws.Frame
	raw    chan json.RawMessage
	state  stateUpdate
}

func dial(t *testing.T, url, query string) *wsConn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(url+"?"+query, nil)
	if err != nil {
		t.Fatal(err)
	}
	c := &wsConn{t: t, conn: conn, frames: make(chan ws.Frame, 1024), raw: make(chan json.RawMessage, 1024)}
	t.Cleanup(func() { conn.Close() })
	go func() {
		defer close(c.frames)
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			for _, line := range strings.Split(string(data), "\n") {
				var f struct {
					ws.Frame
					Payload json.RawMessage `json:"payload"`
				}
				if json.Unmarshal([]byte(line), &f) != nil {
					continue
				}
				f.Frame.Payload = f.Payload
				c.frames <- f.Frame
			}
		}
	}()
	return c
}

func (c *wsConn) send(id, typ string, payload any, extra ...func(*ws.Action)) {
	c.t.Helper()
	b, _ := json.Marshal(payload)
	a := ws.Action{ID: id, Type: typ, Payload: b}
	for _, f := range extra {
		f(&a)
	}
	if err := c.conn.WriteJSON(a); err != nil {
		c.t.Fatal(err)
	}
}

// next waits for a frame matching ok, keeping the latest fight state.
func (c *wsConn) next(what string, ok func(ws.Frame) bool) ws.Frame {
	c.t.Helper()
	timeout := time.After(3 * time.Second)
	for {
		select {
		case f, open := <-c.frames:
			if !open {
				c.t.Fatalf("connection closed while waiting for %s", what)
			}
			if f.Type == "STATE_UPDATE" {
				json.Unmarshal(f.Payload.(json.RawMessage), &c.state)
			}
			if ok(f) {
				return f
			}
		case <-timeout:
			c.t.Fatalf("timeout waiting for %s", what)
		}
	}
}

// result waits for the ACK or NACK of action id and returns the NACK reason ("" for ACK).
func (c *wsConn) result(id string) string {
	c.t.Helper()
	f := c.next("ack of "+id, func(f ws.Frame) bool {
		if f.Type != ws.TypeAck && f.Type != ws.TypeNack {
			return false
		}
		var p ws.NackPayload
		json.Unmarshal(f.Payload.(json.RawMessage), &p)
		return p.ID == id
	})
	var p ws.NackPayload
	json.Unmarshal(f.Payload.(json.RawMessage), &p)
	if f.Type == ws.TypeAck {
		return ""
	}
	return p.Reason
}

func (c *wsConn) waitState(what string, ok func(stateUpdate) bool) {
	c.t.Helper()
	if ok(c.state) {
		return
	}
	c.next(what, func(f ws.Frame) bool { return f.Type == "STATE_UPDATE" && ok(c.state) })
}

func judges(t *testing.T, url string) [4]*wsConn {
	var j [4]*wsConn
	for seat := 1; seat <= 3; seat++ {
		j[seat] = dial(t, url, "role=judge&seat="+string(rune('0'+seat))+"&device=phone-"+string(rune('0'+seat)))
	}
	return j
}

func TestStartNeedsAllThreeJudges(t *testing.T) {
	url, _ := wsServer(t)
	op := dial(t, url, "role=operator")
	op.send("start-1", "START_ROUND", nil)
	if r := op.result("start-1"); r != "judges_not_connected" {
		t.Fatalf("start without judges: %q, want judges_not_connected", r)
	}
	judges(t, url)
	op.waitState("3 seats connected", func(s stateUpdate) bool {
		return len(s.Judges) == 3 && s.Judges[0].Connected && s.Judges[1].Connected && s.Judges[2].Connected
	})
	op.send("start-2", "START_ROUND", nil)
	if r := op.result("start-2"); r != "" {
		t.Fatalf("start with 3 judges: NACK %q", r)
	}
}

func TestRolesAreEnforced(t *testing.T) {
	url, _ := wsServer(t)
	j := judges(t, url)
	op := dial(t, url, "role=operator")
	viewer := dial(t, url, "role=viewer")
	op.send("s", "START_ROUND", nil)
	op.result("s")

	j[1].send("kd", "KNOCKDOWN", map[string]string{"corner": "Red"})
	if r := j[1].result("kd"); r != "not_allowed" {
		t.Fatalf("judge sending KNOCKDOWN: %q, want not_allowed", r)
	}
	op.send("hit", "REGISTER_HIT", map[string]any{"seat": 1, "corner": "Red"})
	if r := op.result("hit"); r != "not_allowed" {
		t.Fatalf("operator sending a hit: %q, want not_allowed", r)
	}
	viewer.send("v", "PAUSE_ROUND", nil)
	if r := viewer.result("v"); r != "not_allowed" {
		t.Fatalf("viewer action: %q, want not_allowed", r)
	}
	// A judge's seat comes from the connection, not from the payload.
	j[2].send("h2", "REGISTER_HIT", map[string]any{"seat": 1, "corner": "Blue"})
	j[2].result("h2")
	if v := theRing.View(); v.Judges[1].Hits != 1 || v.Judges[0].Hits != 0 {
		t.Fatalf("hits = %d/%d, want the tap on seat 2", v.Judges[0].Hits, v.Judges[1].Hits)
	}
}

func TestSpec_S15_SecondPhoneTakesOverSeat(t *testing.T) {
	url, _ := wsServer(t)
	j := judges(t, url)
	op := dial(t, url, "role=operator")
	op.send("s", "START_ROUND", nil)
	op.result("s")

	first := j[1]
	second := dial(t, url, "role=judge&seat=1&device=other-phone")
	first.next("SESSION_REPLACED", func(f ws.Frame) bool { return f.Type == ws.TypeSessionReplaced })
	if _, open := <-first.frames; open {
		// drain until closed
		for range first.frames {
		}
	}

	second.send("t1", "REGISTER_HIT", map[string]string{"corner": "Red"})
	if r := second.result("t1"); r != "" {
		t.Fatalf("new phone tap: NACK %q", r)
	}
	// The old phone is gone; its taps cannot arrive any more, so nothing doubles.
	if err := first.conn.WriteJSON(ws.Action{ID: "t2", Type: "REGISTER_HIT", Payload: json.RawMessage(`{"corner":"Red"}`)}); err == nil {
		time.Sleep(100 * time.Millisecond)
	}
	if v := theRing.View(); v.Judges[0].Hits != 1 || !v.Judges[0].Connected {
		t.Fatalf("seat 1 = %+v, want 1 hit and still connected", v.Judges[0])
	}
}

func TestSpec_S16_GongGraceOverWebSocket(t *testing.T) {
	url, clk := wsServer(t)
	j := judges(t, url)
	op := dial(t, url, "role=operator")
	op.send("s", "START_ROUND", nil)
	op.result("s")
	op.send("e", "END_ROUND", nil)
	op.result("e")

	clk.Advance(300 * time.Millisecond)
	j[1].send("late-300", "REGISTER_HIT", map[string]string{"corner": "Red"})
	if r := j[1].result("late-300"); r != "" {
		t.Fatalf("0.3 s after gong: NACK %q, want ACK", r)
	}
	clk.Advance(700 * time.Millisecond)
	j[1].send("late-1000", "REGISTER_HIT", map[string]string{"corner": "Red"})
	if r := j[1].result("late-1000"); r != match.ErrClockNotRunning.Error() {
		t.Fatalf("1 s after gong: %q, want clock_not_running", r)
	}
}

func TestSpec_S11_OfflineTapsCountedOnceAfterReconnect(t *testing.T) {
	url, clk := wsServer(t)
	j := judges(t, url)
	op := dial(t, url, "role=operator")
	op.send("s", "START_ROUND", nil)
	op.result("s")
	start := clock.Ms(clk.Now())
	fightID := theRing.Fight().Config.FightID

	// Judge 1's Wi-Fi drops for 20 s; the phone queues 4 taps with their device time.
	j[1].conn.Close()
	var taps []ws.Action
	for i := range 4 {
		clk.Advance(5 * time.Second)
		p, _ := json.Marshal(map[string]string{"corner": "Blue", "fight_id": fightID})
		taps = append(taps, ws.Action{ID: "offline-" + string(rune('a'+i)), Type: "REGISTER_HIT", Payload: p, ClientTime: clock.Ms(clk.Now()), Offline: true})
	}
	clk.Advance(200 * time.Second) // the round has ended by itself meanwhile
	if p := theRing.View().Clock.Phase; p != match.Rest {
		t.Fatalf("phase = %s, want REST", p)
	}

	back := dial(t, url, "role=judge&seat=1&device=phone-1")
	for round := range 2 { // the queue is sent, then sent again (lost ACKs)
		for _, a := range taps {
			back.conn.WriteJSON(a)
			if r := back.result(a.ID); r != "" {
				t.Fatalf("round %d, %s: NACK %q", round, a.ID, r)
			}
		}
	}
	v := theRing.View()
	if v.Judges[0].Hits != 4 || v.Judges[0].Rounds[0].Blue != 4 {
		t.Fatalf("judge 1 = %+v, want exactly 4 blue hits in round 1", v.Judges[0])
	}

	// A tap queued in another fight is refused.
	p, _ := json.Marshal(map[string]string{"corner": "Red", "fight_id": "f-old"})
	back.conn.WriteJSON(ws.Action{ID: "stale", Type: "REGISTER_HIT", Payload: p, ClientTime: start + 1000, Offline: true})
	if r := back.result("stale"); r != "wrong_fight" {
		t.Fatalf("tap from another fight: %q, want wrong_fight", r)
	}
}

func TestResentTournamentActionAppliedOnce(t *testing.T) {
	url, _ := wsServer(t)
	op := dial(t, url, "role=operator")
	for range 2 {
		op.send("add-cat", "ADD_CATEGORY", map[string]string{"name": "-71kg"})
		if r := op.result("add-cat"); r != "" {
			t.Fatalf("NACK %q", r)
		}
	}
	tournamentMutex.RLock()
	n := len(tournamentState.Categories)
	tournamentMutex.RUnlock()
	if n != 1 {
		t.Fatalf("categories = %d, want 1", n)
	}
}

func TestLargeActionIsAccepted(t *testing.T) {
	url, _ := wsServer(t)
	op := dial(t, url, "role=operator")
	seeding := make([]string, 32)
	for i := range seeding {
		seeding[i] = strings.Repeat("x", 40) // ~1.5 KB, well over the old 512-byte limit
	}
	op.send("big", "GENERATE_BRACKET", map[string]any{"category_id": "none", "manual_seeding": seeding})
	if r := op.result("big"); r != "rejected" {
		t.Fatalf("got %q, want an answer (rejected: unknown category), not a dropped socket", r)
	}
}
