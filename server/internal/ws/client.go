package ws

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait = 10 * time.Second
	// A dead connection is noticed within pongWait, so the operator sees a
	// judge drop off quickly (§9).
	pongWait   = 10 * time.Second
	pingPeriod = 4 * time.Second
	// MaxMessageSize is the largest action a client may send.
	MaxMessageSize = 64 * 1024
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // local network and our own HTTPS origin
	},
}

// Client is one WebSocket connection.
type Client struct {
	hub     *Hub
	conn    *websocket.Conn
	send    chan []byte
	session Session
}

// SessionFromQuery reads ?role=judge&seat=2&device=… ; anything else is an operator.
func SessionFromQuery(r *http.Request) Session {
	q := r.URL.Query()
	s := Session{Role: Role(q.Get("role")), Device: q.Get("device")}
	switch s.Role {
	case RoleJudge:
		s.Seat, _ = strconv.Atoi(q.Get("seat"))
		if s.Seat < 1 || s.Seat > 3 {
			s.Role = RoleViewer
			s.Seat = 0
		}
	case RoleViewer:
	default:
		s.Role = RoleOperator
	}
	return s
}

// ServeWS upgrades the request and attaches the connection to the hub.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	c := &Client{hub: h, conn: conn, send: make(chan []byte, 256), session: SessionFromQuery(r)}
	h.register <- c
	// Register first, then send the full state: a broadcast in between is not
	// lost, and the client keeps whichever state frame has the higher seq.
	for _, b := range h.handler.Snapshot() {
		h.direct <- directMessage{client: c, data: b}
	}
	go c.writePump()
	go c.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(MaxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error { c.conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if errors.Is(err, websocket.ErrReadLimit) {
				log.Printf("ws: %s sent a frame over %d bytes; closing", c.session.Role, MaxMessageSize)
			} else if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("ws: %v", err)
			}
			return
		}
		var a Action
		if err := json.Unmarshal(message, &a); err != nil {
			log.Printf("ws: bad frame from %s: %v", c.session.Role, err)
			continue
		}
		// Any frame proves the connection is alive.
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		if a.Type == TypeTimeSync {
			c.hub.reply(c, TypeTimeSync, a.Payload)
			continue
		}
		err = c.hub.handler.HandleAction(c.session, a)
		if a.ID == "" {
			continue
		}
		if err != nil {
			c.hub.reply(c, TypeNack, NackPayload{ID: a.ID, Reason: err.Error()})
		} else {
			c.hub.reply(c, TypeAck, AckPayload{ID: a.ID})
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)
			// Batch queued frames into one, separated by newlines.
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.send)
			}
			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
