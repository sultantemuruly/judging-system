package ws

import (
	"encoding/json"
	"log"
	"sync"
)

// Handler is what the hub needs from the application.
type Handler interface {
	// HandleAction applies one action; nil means ACK, an error means NACK
	// with err.Error() as the reason.
	HandleAction(s Session, a Action) error
	// Snapshot is the full current state, sent to every new connection.
	Snapshot() [][]byte
	// SeatsChanged reports which judge seats (index 1–3) have a live device.
	// It is called from its own goroutine, one call at a time, always ending
	// with the latest seats; changes that happen meanwhile are merged.
	SeatsChanged(seats [4]bool)
	// QueueStatus reports how many actions a judge's device still holds unconfirmed.
	QueueStatus(s Session, pending int)
}

// Hub keeps the set of connections and the judge seats. Only its run
// goroutine touches clients and seats.
type Hub struct {
	handler    Handler
	now        func() int64
	clients    map[*Client]bool
	seats      [4]*Client
	broadcast  chan []byte
	direct     chan directMessage
	register   chan *Client
	unregister chan *Client

	// The latest seats, handed to SeatsChanged without ever blocking the run
	// loop: the handler broadcasts through the hub, so a full queue of seat
	// events would deadlock the two.
	seatMu     sync.Mutex
	seatLatest [4]bool
	seatSignal chan struct{}
}

type directMessage struct {
	client *Client
	data   []byte
}

func NewHub(h Handler, nowMs func() int64) *Hub {
	return &Hub{
		handler:    h,
		now:        nowMs,
		clients:    map[*Client]bool{},
		broadcast:  make(chan []byte, 64),
		direct:     make(chan directMessage, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		seatSignal: make(chan struct{}, 1),
	}
}

// Run serves the hub until the process exits.
func (h *Hub) Run() {
	go func() {
		for range h.seatSignal {
			h.seatMu.Lock()
			seats := h.seatLatest
			h.seatMu.Unlock()
			h.handler.SeatsChanged(seats)
		}
	}()
	for {
		select {
		case c := <-h.register:
			h.clients[c] = true
			if c.session.Role == RoleJudge {
				h.takeSeat(c)
			}
		case c := <-h.unregister:
			h.drop(c)
		case m := <-h.direct:
			if h.clients[m.client] {
				h.deliver(m.client, m.data)
			}
		case b := <-h.broadcast:
			for c := range h.clients {
				h.deliver(c, b)
			}
		}
	}
}

// Broadcast sends a frame to every connection.
func (h *Hub) Broadcast(b []byte) { h.broadcast <- b }

// takeSeat gives the judge seat to c. The connection that held it is told why
// and disconnected, so one seat never has two devices (§1, S15). It is told
// even when it is the same browser: a second tab must stop rather than
// reconnect and take the seat back, over and over. A page that reconnects has
// already dropped its old socket, so it never sees the message.
func (h *Hub) takeSeat(c *Client) {
	old := h.seats[c.session.Seat]
	h.seats[c.session.Seat] = c
	if old != nil && old != c {
		if old.session.Device != c.session.Device {
			log.Printf("ws: judge seat %d taken over by another device", c.session.Seat)
		}
		h.deliver(old, h.frame(TypeSessionReplaced, SessionReplacedPayload{Reason: "another_device"}))
		h.close(old)
	}
	h.seatsChanged()
}

func (h *Hub) drop(c *Client) {
	if !h.clients[c] {
		return
	}
	h.close(c)
	if c.session.Role == RoleJudge && h.seats[c.session.Seat] == c {
		h.seats[c.session.Seat] = nil
		h.seatsChanged()
	}
}

func (h *Hub) close(c *Client) {
	if h.clients[c] {
		delete(h.clients, c)
		close(c.send)
	}
}

// deliver queues b for c; a client too slow to keep up is disconnected.
func (h *Hub) deliver(c *Client, b []byte) {
	select {
	case c.send <- b:
	default:
		log.Printf("ws: dropping slow %s connection", c.session.Role)
		h.drop(c)
	}
}

func (h *Hub) seatsChanged() {
	var seats [4]bool
	for i := 1; i < len(h.seats); i++ {
		seats[i] = h.seats[i] != nil
	}
	h.seatMu.Lock()
	h.seatLatest = seats
	h.seatMu.Unlock()
	select {
	case h.seatSignal <- struct{}{}:
	default: // a report is already due; it will read the latest seats
	}
}

func (h *Hub) frame(typ string, payload any) []byte {
	b, err := json.Marshal(Frame{Type: typ, Payload: payload, ServerTime: h.now()})
	if err != nil {
		log.Printf("ws: marshal %s: %v", typ, err)
	}
	return b
}

// reply sends a frame to one client, if it is still connected.
func (h *Hub) reply(c *Client, typ string, payload any) {
	h.direct <- directMessage{client: c, data: h.frame(typ, payload)}
}
