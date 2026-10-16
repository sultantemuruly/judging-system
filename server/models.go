package main

import "encoding/json"

// ClientMessage is the structure of incoming WS messages
type ClientMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// ServerMessage is the structure of outgoing WS messages
type ServerMessage struct {
	Type       string `json:"type"`
	Payload    any    `json:"payload"`
	ServerTime int64  `json:"server_time"`
}

// ProcessAction routes a client action to the fight or the tournament.
func ProcessAction(hub *Hub, msg ClientMessage) {
	switch msg.Type {
	case "ADD_CATEGORY", "EDIT_CATEGORY", "DELETE_CATEGORY",
		"ADD_FIGHTER", "EDIT_FIGHTER", "DELETE_FIGHTER",
		"GENERATE_BRACKET", "START_BRACKET_MATCH",
		"SWAP_FIGHTERS", "SET_MATCH_WINNER":
		ProcessTournamentAction(hub, msg)
	default:
		processFightAction(hub, msg)
	}
}
