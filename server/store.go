package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"
)

var (
	stateMutex sync.RWMutex
	appState   MatchState
)

func init() {
	resetState()
}

func resetState() {
	prevRoundDur := appState.RoundDuration
	if prevRoundDur == 0 {
		prevRoundDur = 120
	}
	prevRestDur := appState.RestDuration
	if prevRestDur == 0 {
		prevRestDur = 60
	}

	appState = MatchState{
		MatchID:      "match-1",
		CurrentRound: 1,
		Rounds: []RoundState{
			{
				RoundID:    1,
				Status:     RoundNotStarted,
				JudgeHits:  make(map[string]*JudgeHitTracker),
				Knockdowns: map[string]int{"Red": 0, "Blue": 0},
			},
		},
		OfficialWarnings: map[string]int{"Red": 0, "Blue": 0},
		WarningPenalties: map[string]int{"Red": 0, "Blue": 0},
		WarningHistory:   []OfficialWarning{},
		RestEndTime:      nil,
		RoundDuration:    prevRoundDur,
		RestDuration:     prevRestDur,
	}
}

// BroadcastState sends the entire state to all connected clients
func BroadcastState(hub *Hub) {
	stateMutex.RLock()
	defer stateMutex.RUnlock()

	msg := ServerMessage{
		Type:    "STATE_UPDATE",
		Payload: appState,
	}

	bytes, err := json.Marshal(msg)
	if err == nil {
		hub.broadcast <- bytes
	}
}

// EnsureCurrentRound ensures that we have a round state initialized for the current round
func EnsureCurrentRound() *RoundState {
	if len(appState.Rounds) == 0 {
		appState.CurrentRound = 1
		appState.Rounds = append(appState.Rounds, RoundState{
			RoundID:     1,
			Status:      RoundNotStarted,
			ElapsedTime: 0,
			JudgeHits:   make(map[string]*JudgeHitTracker),
			Knockdowns:  map[string]int{"Red": 0, "Blue": 0},
		})
	}
	// Return pointer to the current round
	return &appState.Rounds[appState.CurrentRound-1]
}

// getJudgeRoundScore calculates a judge's score for a specific round for each fighter
func getJudgeRoundScore(round *RoundState, judgeID string) (int, int) {
	red := 0
	blue := 0
	tracker, exists := round.JudgeHits[judgeID]
	if !exists {
		return 0, 0
	}
	for _, hit := range tracker.Hits {
		if hit.Fighter == RedFighter {
			red++
		} else if hit.Fighter == BlueFighter {
			blue++
		}
	}
	return red, blue
}

// getAllJudgeIDs collects all unique judge IDs across all rounds
func getAllJudgeIDs() []string {
	ids := map[string]bool{}
	for _, round := range appState.Rounds {
		for jid := range round.JudgeHits {
			ids[jid] = true
		}
	}
	result := []string{}
	for id := range ids {
		result = append(result, id)
	}
	return result
}

// CalculateMatchWinner determines the overall fight winner.
// Each judge sums hits across ALL rounds, subtracts warning penalties,
// then picks a winner. Tiebreak: R3 > R2 > R1.
// Match winner = majority of judges' picks.
func CalculateMatchWinner() {
	judges := getAllJudgeIDs()
	if len(judges) == 0 {
		return
	}

	redVotes := 0
	blueVotes := 0
	drawVotes := 0

	for _, judgeID := range judges {
		totalRed := 0
		totalBlue := 0

		// Sum across all rounds
		for i := range appState.Rounds {
			r, b := getJudgeRoundScore(&appState.Rounds[i], judgeID)
			totalRed += r
			totalBlue += b
		}

		// Subtract warning penalties (applied equally to all judges)
		totalRed -= appState.WarningPenalties[string(RedFighter)]
		totalBlue -= appState.WarningPenalties[string(BlueFighter)]



		// Determine this judge's pick
		if totalRed > totalBlue {
			redVotes++
		} else if totalBlue > totalRed {
			blueVotes++
		} else {
			// Tiebreak: R3 > R2 > R1
			resolved := false
			// Check rounds in reverse order (3, 2, 1)
			for ri := len(appState.Rounds) - 1; ri >= 0; ri-- {
				rr, rb := getJudgeRoundScore(&appState.Rounds[ri], judgeID)
				if rr > rb {
					redVotes++
					resolved = true
					break
				} else if rb > rr {
					blueVotes++
					resolved = true
					break
				}
			}
			if !resolved {
				drawVotes++
			}
		}
	}

	// Majority vote
	if redVotes > blueVotes {
		res := RedFighter
		appState.MatchWinner = &res
	} else if blueVotes > redVotes {
		res := BlueFighter
		appState.MatchWinner = &res
	} else {
		res := Fighter("Draw")
		appState.MatchWinner = &res
	}
	if appState.MatchResult == "" {
		appState.MatchResult = "DECISION"
	}
}

// ProcessAction interprets an incoming message and modifies state accordingly
func ProcessAction(hub *Hub, msg ClientMessage) {
	// Route tournament-specific actions
	switch msg.Type {
	case "ADD_CATEGORY", "EDIT_CATEGORY", "DELETE_CATEGORY",
		"ADD_FIGHTER", "EDIT_FIGHTER", "DELETE_FIGHTER",
		"GENERATE_BRACKET", "START_BRACKET_MATCH",
		"SWAP_FIGHTERS", "SET_MATCH_WINNER":
		ProcessTournamentAction(hub, msg)
		return
	}

	stateMutex.Lock()
	defer stateMutex.Unlock()

	payloadBytes, _ := json.Marshal(msg.Payload)
	changed := false

	// Handle NEW_FIGHT before anything else
	if msg.Type == "NEW_FIGHT" {
		resetState()
		changed = true
		if changed {
			stateMutex.Unlock()
			BroadcastState(hub)
			stateMutex.Lock()
		}
		return
	}

	// Don't allow actions if fight has ended (TKO/DQ)
	if appState.FightEnded && msg.Type != "NEW_FIGHT" {
		return
	}

	round := EnsureCurrentRound()

	switch msg.Type {

	case "UPDATE_MATCH_SETTINGS":
		var p struct {
			RoundDuration int `json:"round_duration"`
			RestDuration  int `json:"rest_duration"`
		}
		if err := json.Unmarshal(payloadBytes, &p); err == nil {
			appState.RoundDuration = p.RoundDuration
			appState.RestDuration = p.RestDuration
			changed = true
		}

	case "START_ROUND":
		if round.Status == RoundNotStarted {
			round.Status = RoundRunning
			now := time.Now().UnixMilli()
			round.StartTime = &now
			round.LastResumeTime = &now
			appState.RestEndTime = nil
			changed = true
		} else if round.Status == RoundEnded {
			// Move to next round
			appState.CurrentRound++
			newRound := RoundState{
				RoundID:     appState.CurrentRound,
				Status:      RoundRunning,
				ElapsedTime: 0,
				JudgeHits:   make(map[string]*JudgeHitTracker),
				Knockdowns:  map[string]int{"Red": 0, "Blue": 0},
			}
			now := time.Now().UnixMilli()
			newRound.StartTime = &now
			newRound.LastResumeTime = &now
			appState.Rounds = append(appState.Rounds, newRound)
			appState.RestEndTime = nil
			changed = true
		}

	case "PAUSE_ROUND":
		if round.Status == RoundRunning {
			round.Status = RoundPaused
			if round.LastResumeTime != nil {
				now := time.Now().UnixMilli()
				round.ElapsedTime += (now - *round.LastResumeTime)
				round.LastResumeTime = nil
			}
			changed = true
		}

	case "RESUME_ROUND":
		if round.Status == RoundPaused {
			round.Status = RoundRunning
			now := time.Now().UnixMilli()
			round.LastResumeTime = &now
			changed = true
		}

	case "END_ROUND":
		if round.Status == RoundRunning || round.Status == RoundPaused {
			// Accumulate elapsed time BEFORE changing status
			if round.Status == RoundRunning && round.LastResumeTime != nil {
				now := time.Now().UnixMilli()
				round.ElapsedTime += (now - *round.LastResumeTime)
				round.LastResumeTime = nil
			}
			round.Status = RoundEnded
			now := time.Now().UnixMilli()
			round.EndTime = &now
			// After round 3, calculate overall match winner
			if appState.CurrentRound >= 3 {
				CalculateMatchWinner()
				appState.FightEnded = true
				appState.RestEndTime = nil
				// Auto-advance bracket
				if appState.MatchWinner != nil {
					go CompleteBracketMatch(hub, *appState.MatchWinner)
				}
			} else {
				now := time.Now().UnixMilli()
				restEnd := now + int64(appState.RestDuration*1000)
				appState.RestEndTime = &restEnd
			}
			changed = true
		}

	case "REGISTER_HIT":
		var p struct {
			JudgeID string `json:"judge_id"`
			Hit     Hit    `json:"hit"`
		}
		if err := json.Unmarshal(payloadBytes, &p); err == nil {
			if round.Status == RoundRunning {
				if round.JudgeHits[p.JudgeID] == nil {
					round.JudgeHits[p.JudgeID] = &JudgeHitTracker{
						JudgeID: p.JudgeID,
						Hits:    []Hit{},
					}
				}
				p.Hit.Timestamp = time.Now().UnixMilli()
				round.JudgeHits[p.JudgeID].Hits = append(round.JudgeHits[p.JudgeID].Hits, p.Hit)
				changed = true
			}
		}

	case "UNDO_HIT":
		var p struct {
			JudgeID string  `json:"judge_id"`
			Fighter Fighter `json:"fighter"`
		}
		if err := json.Unmarshal(payloadBytes, &p); err == nil {
			if round.Status == RoundRunning {
				if tracker, exists := round.JudgeHits[p.JudgeID]; exists && len(tracker.Hits) > 0 {
					if p.Fighter != "" {
						// Remove last hit of the specific fighter
						for i := len(tracker.Hits) - 1; i >= 0; i-- {
							if tracker.Hits[i].Fighter == p.Fighter {
								tracker.Hits = append(tracker.Hits[:i], tracker.Hits[i+1:]...)
								break
							}
						}
					} else {
						// Legacy: remove last hit regardless
						tracker.Hits = tracker.Hits[:len(tracker.Hits)-1]
					}
					changed = true
				}
			}
		}

	case "KNOCKDOWN":
		var p struct {
			Fighter Fighter `json:"fighter"`
		}
		if err := json.Unmarshal(payloadBytes, &p); err == nil {
			if round.Status == RoundRunning || round.Status == RoundPaused {
				fighterKey := string(p.Fighter)
				round.Knockdowns[fighterKey]++
				log.Printf("Knockdown registered for %s in round %d (total: %d)", p.Fighter, round.RoundID, round.Knockdowns[fighterKey])

				// 3 knockdowns in one round = TKO
				if round.Knockdowns[fighterKey] >= 3 {
					// The OTHER fighter wins by TKO
					var winner Fighter
					if p.Fighter == RedFighter {
						winner = BlueFighter
					} else {
						winner = RedFighter
					}
					appState.MatchWinner = &winner
					appState.MatchResult = "TKO"
					appState.FightEnded = true
					appState.RestEndTime = nil

					// End the current round
					if round.Status == RoundRunning && round.LastResumeTime != nil {
						now := time.Now().UnixMilli()
						round.ElapsedTime += (now - *round.LastResumeTime)
						round.LastResumeTime = nil
					}
					round.Status = RoundEnded
					now := time.Now().UnixMilli()
					round.EndTime = &now

					// Auto-advance bracket
					go CompleteBracketMatch(hub, winner)
				}
				changed = true
			}
		}

	case "OFFICIAL_WARNING":
		var p struct {
			Fighter Fighter `json:"fighter"`
		}
		if err := json.Unmarshal(payloadBytes, &p); err == nil {
			fighterKey := string(p.Fighter)
			appState.OfficialWarnings[fighterKey]++
			count := appState.OfficialWarnings[fighterKey]

			// Add to history
			appState.WarningHistory = append(appState.WarningHistory, OfficialWarning{
				ID:      fmt.Sprintf("ow-%s-%d", fighterKey, count),
				Fighter: p.Fighter,
				Round:   appState.CurrentRound,
				Time:    time.Now().UnixMilli(),
			})

			log.Printf("Official warning #%d for %s", count, p.Fighter)

			if count == 2 || count == 3 {
				// Deduct 3 points
				appState.WarningPenalties[fighterKey] += 3
				log.Printf("Warning penalty: -%d total for %s", appState.WarningPenalties[fighterKey], p.Fighter)
			} else if count >= 4 {
				// Disqualification
				appState.Disqualified = &p.Fighter
				// The OTHER fighter wins by DQ
				var winner Fighter
				if p.Fighter == RedFighter {
					winner = BlueFighter
				} else {
					winner = RedFighter
				}
				appState.MatchWinner = &winner
				appState.MatchResult = "DQ"
				appState.FightEnded = true
				appState.RestEndTime = nil

				// End the current round
				if round.Status == RoundRunning && round.LastResumeTime != nil {
					now := time.Now().UnixMilli()
					round.ElapsedTime += (now - *round.LastResumeTime)
					round.LastResumeTime = nil
				}
				if round.Status == RoundRunning || round.Status == RoundPaused {
					round.Status = RoundEnded
					now := time.Now().UnixMilli()
					round.EndTime = &now
				}

				// Auto-advance bracket
				go CompleteBracketMatch(hub, winner)
			}

			// Recalculate match winner if after round 3
			if appState.CurrentRound >= 3 && !appState.FightEnded {
				for i := range appState.Rounds {
					if appState.Rounds[i].Status == RoundEnded {
						CalculateMatchWinner()
						break
					}
				}
			}

			changed = true
		}
	}

	if changed {
		// Unlock early before broadcasting to prevent deadlock if broadcast takes time
		stateMutex.Unlock()
		BroadcastState(hub)
		stateMutex.Lock() // re-lock for defer semantics
	}
}
