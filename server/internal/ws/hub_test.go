package ws

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// broadcastingHandler answers every seat change the way the app does: by
// broadcasting state frames through the hub.
type broadcastingHandler struct {
	hub     *Hub
	changes atomic.Int64
}

func (h *broadcastingHandler) HandleAction(Session, Action) error { return nil }
func (h *broadcastingHandler) Snapshot() [][]byte                 { return nil }
func (h *broadcastingHandler) QueueStatus(Session, int)           {}
func (h *broadcastingHandler) SeatsChanged([4]bool) {
	h.changes.Add(1)
	time.Sleep(time.Millisecond) // computing the view takes a moment
	for range 100 {
		h.hub.Broadcast([]byte(`{"type":"STATE_UPDATE"}`))
	}
}

// Many judge connections coming and going must never deadlock the hub with
// the goroutine that reports seat changes.
func TestSeatChurnDoesNotDeadlockHub(t *testing.T) {
	h := &broadcastingHandler{}
	h.hub = NewHub(h, func() int64 { return 0 })
	go h.hub.Run()
	srv := httptest.NewServer(http.HandlerFunc(h.hub.ServeWS))
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "?role=judge&seat=1"

	done := make(chan struct{})
	go func() {
		defer close(done)
		var wg sync.WaitGroup
		for range 20 {
			wg.Go(func() {
				for range 30 {
					c, _, err := websocket.DefaultDialer.Dial(url, nil)
					if err != nil {
						t.Error(err)
						return
					}
					c.Close()
				}
			})
		}
		wg.Wait()
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("hub deadlocked under seat churn")
	}
	if h.changes.Load() == 0 {
		t.Fatal("seat changes were never reported")
	}

	// The hub must still deliver: a new viewer receives a broadcast.
	v, _, err := websocket.DefaultDialer.Dial(strings.Replace(url, "role=judge&seat=1", "role=viewer", 1), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer v.Close()
	go func() {
		for range 50 {
			h.hub.Broadcast([]byte(`{"type":"PING_TEST"}`))
			time.Sleep(20 * time.Millisecond)
		}
	}()
	v.SetReadDeadline(time.Now().Add(10 * time.Second))
	for {
		_, data, err := v.ReadMessage()
		if err != nil {
			t.Fatalf("hub stopped delivering after seat churn: %v", err)
		}
		if strings.Contains(string(data), "PING_TEST") {
			return
		}
	}
}
