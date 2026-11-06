package ws

import (
	"encoding/json"
	"errors"
	"fmt"
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
	// helloWait: a client that hasn't sent HELLO by then is dropped.
	helloWait = 5 * time.Second
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

// SessionFromQuery reads ?role=judge&seat=2 ; anything else is an operator.
// The device and its credentials come in the HELLO frame.
func SessionFromQuery(r *http.Request) Session {
	q := r.URL.Query()
	s := Session{Role: Role(q.Get("role"))}
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
	session := SessionFromQuery(r)
	hello, err := readHello(conn)
	if err != nil {
		log.Printf("ws: %s connection without HELLO: %v", session.Role, err)
		conn.Close()
		return
	}
	session.Device = hello.Device
	switch session.Role {
	case RoleJudge:
		if wait, ok := h.handler.JudgeAllowed(session.Seat, session.Device, hello.Password); !ok {
			h.refuse(conn, TypeJudgeAuthFailed, JudgeAuthFailedPayload{Seat: session.Seat, RetryAfterMs: wait})
			return
		}
	case RoleOperator:
		if !h.handler.OperatorAllowed(hello.Token) {
			h.refuse(conn, TypeAdminAuthFailed, struct{}{})
			return
		}
	}
	c := &Client{hub: h, conn: conn, send: make(chan []byte, 256), session: session}
	h.register <- c
	// Register first, then send the full state: a broadcast in between is not
	// lost, and the client keeps whichever state frame has the higher seq.
	for _, b := range h.handler.Snapshot() {
		h.direct <- directMessage{client: c, data: b}
	}
	go c.writePump()
	go c.readPump()
}

// readHello reads the client's first frame, which must be HELLO.
func readHello(conn *websocket.Conn) (HelloPayload, error) {
	var p HelloPayload
	conn.SetReadLimit(MaxMessageSize)
	conn.SetReadDeadline(time.Now().Add(helloWait))
	_, data, err := conn.ReadMessage()
	if err != nil {
		return p, err
	}
	var a Action
	if err := json.Unmarshal(data, &a); err != nil {
		return p, err
	}
	if a.Type != TypeHello {
		return p, fmt.Errorf("first frame is %q", a.Type)
	}
	if len(a.Payload) > 0 {
		if err := json.Unmarshal(a.Payload, &p); err != nil {
			return p, err
		}
	}
	return p, nil
}

// refuse tells a device its password or login isn't valid and closes the
// connection. The device never joins the hub, so it takes no seat away.
// Not logged here: the app logs lockouts, not every wrong try.
func (h *Hub) refuse(conn *websocket.Conn, typ string, payload any) {
	conn.SetWriteDeadline(time.Now().Add(writeWait))
	conn.WriteJSON(Frame{Type: typ, Payload: payload, ServerTime: h.now()})
	conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "wrong password"))
	conn.Close()
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
		if c.session.Role == RoleJudge {
			c.hub.handler.Heard(c.session)
		}
		if a.Type == TypeTimeSync {
			c.hub.reply(c, TypeTimeSync, a.Payload)
			continue
		}
		if a.Type == TypeQueueStatus {
			var p QueueStatusPayload
			if c.session.Role == RoleJudge && json.Unmarshal(a.Payload, &p) == nil {
				c.hub.handler.QueueStatus(c.session, p.Pending)
			}
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
