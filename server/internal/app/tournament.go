package app

import (
	"encoding/json"
	"log"

	"judging-server/internal/match"
	"judging-server/internal/tournament"
	"judging-server/internal/ws"
)

func (a *App) loadTournament(legacyPath string) error {
	var st tournament.State
	ok, err := a.store.LoadTournament(&st, legacyPath)
	if err != nil {
		return err
	}
	if !ok {
		log.Println("No saved tournament state found, starting fresh")
	}
	st.Normalize()
	a.tmu.Lock()
	a.tournament = st
	a.tmu.Unlock()
	return nil
}

// tournamentFrame is the TOURNAMENT_STATE_UPDATE frame.
func (a *App) tournamentFrame() []byte {
	a.tournamentMu.Lock()
	defer a.tournamentMu.Unlock()
	return a.tournamentFrameLocked()
}

func (a *App) tournamentFrameLocked() []byte {
	a.tmu.Lock()
	defer a.tmu.Unlock()
	a.tournamentSeq++
	b, err := json.Marshal(ws.Frame{Type: "TOURNAMENT_STATE_UPDATE", Payload: a.tournament, ServerTime: a.nowMs(), Seq: a.tournamentSeq})
	if err != nil {
		log.Printf("marshal tournament: %v", err)
	}
	return b
}

func (a *App) broadcastTournament() {
	a.tournamentMu.Lock()
	defer a.tournamentMu.Unlock()
	a.hub.Broadcast(a.tournamentFrameLocked())
}

// saveLocked writes the tournament to disk. Caller holds tmu.
func (a *App) saveLocked() error {
	err := a.store.SaveTournament(a.tournament)
	a.unsaved = err != nil
	if err != nil {
		log.Printf("save tournament: %v", err)
	}
	return err
}

// change runs fn on the tournament, then saves and broadcasts it.
func (a *App) change(fn func(*tournament.State) error) error {
	a.tmu.Lock()
	err := fn(&a.tournament)
	if err == nil {
		err = a.saveLocked()
	}
	a.refreshRecordedLocked()
	a.tmu.Unlock()
	a.broadcastTournament()
	return err
}

// fightDecided records a confirmed bracket fight in the bracket (§7). An error
// reaches the operator as a NACK of the confirmation.
func (a *App) fightDecided(f match.Fight) error {
	err := a.record(f)
	if err != nil {
		log.Printf("bracket %s/%s: %v", f.Config.Bracket.CategoryID, f.Config.Bracket.MatchID, err)
	}
	return err
}

// recordConfirmed records the confirmed fight on the ring if the bracket on
// disk is still missing it: after a failed save, or a crash between the fight
// log and tournament.json.
func (a *App) recordConfirmed() error { return a.record(a.ring.Fight()) }

// record writes the result of a confirmed bracket fight into its match and
// saves the tournament. Recording the same fight again only saves again.
func (a *App) record(f match.Fight) error {
	ref := f.Config.Bracket
	if ref == nil || !f.Result().Confirmed {
		return nil
	}
	return a.change(func(s *tournament.State) error {
		b, i, err := s.MatchAt(*ref)
		if err != nil {
			return err
		}
		if m := b.Matches[i]; m.Status == tournament.Completed && m.FightID == f.Config.FightID {
			return nil
		}
		return s.CompleteMatch(*ref, f.Result(), f.Config.FightID)
	})
}

// refreshRecordedLocked recomputes whether the confirmed fight on the ring is
// missing from the bracket on disk and tells clients when that changes.
// Caller holds tmu.
func (a *App) refreshRecordedLocked() {
	f := a.ring.Fight()
	missing := false
	if ref := f.Config.Bracket; ref != nil && f.Result().Confirmed {
		b, i, err := a.tournament.MatchAt(*ref)
		missing = a.unsaved || (err == nil && b.Matches[i].Status == tournament.Active)
	}
	if a.notRecorded.Swap(missing) != missing {
		a.broadcastState()
	}
}

// releaseLocked puts the bracket match of a replaced, unconfirmed fight back
// to PENDING and reports whether it did. Caller holds tmu and broadcasts the
// tournament after unlocking.
func (a *App) releaseLocked(old match.Fight) bool {
	ref := old.Config.Bracket
	if ref == nil || old.Result().Confirmed {
		return false
	}
	a.tournament.ReleaseMatch(*ref)
	a.saveLocked()
	return true
}

type tournamentPayload struct {
	CategoryID    string             `json:"category_id"`
	MatchID       string             `json:"match_id"`
	FighterID     string             `json:"fighter_id"`
	WinnerID      string             `json:"winner_id"`
	Reason        string             `json:"reason"`
	Fighter       tournament.Fighter `json:"fighter"`
	ManualSeeding []string           `json:"manual_seeding"`
	// Category fields
	Name       string `json:"name"`
	Gender     string `json:"gender"`
	Sex        string `json:"sex"`
	Discipline string `json:"discipline"`
	tournament.Format
	// SWAP_FIGHTERS
	MatchID1 string `json:"match_id_1"`
	Slot1    string `json:"slot_1"`
	MatchID2 string `json:"match_id_2"`
	Slot2    string `json:"slot_2"`
	// SET_TOURNAMENT_INFO
	Date string `json:"date"`
}

func (p tournamentPayload) ref() match.BracketRef {
	return match.BracketRef{CategoryID: p.CategoryID, MatchID: p.MatchID}
}

func (p tournamentPayload) category(id string) tournament.Category {
	return tournament.Category{ID: id, Name: p.Name, Gender: p.Gender, Sex: p.Sex, Discipline: p.Discipline, Format: p.Format}
}

// tournamentAction adapts a State method to an action handler.
func tournamentAction(fn func(a *App, s *tournament.State, p tournamentPayload) error) func(*App, ws.Action) error {
	return func(a *App, msg ws.Action) error {
		var p tournamentPayload
		if len(msg.Payload) > 0 {
			if err := json.Unmarshal(msg.Payload, &p); err != nil {
				return errRejected
			}
		}
		return a.change(func(s *tournament.State) error { return fn(a, s, p) })
	}
}

var tournamentActions = map[string]func(*App, ws.Action) error{
	"SET_TOURNAMENT_INFO": tournamentAction(func(_ *App, s *tournament.State, p tournamentPayload) error {
		s.SetInfo(p.Name, p.Date)
		return nil
	}),
	"ADD_CATEGORY": tournamentAction(func(_ *App, s *tournament.State, p tournamentPayload) error {
		return s.AddCategory(p.category(newID("cat-")))
	}),
	"EDIT_CATEGORY": tournamentAction(func(_ *App, s *tournament.State, p tournamentPayload) error {
		return s.EditCategory(p.category(p.CategoryID))
	}),
	"DELETE_CATEGORY": tournamentAction(func(_ *App, s *tournament.State, p tournamentPayload) error {
		return s.DeleteCategory(p.CategoryID)
	}),
	"ADD_FIGHTER": tournamentAction(func(_ *App, s *tournament.State, p tournamentPayload) error {
		p.Fighter.ID = newID("f-")
		return s.AddFighter(p.CategoryID, p.Fighter)
	}),
	"EDIT_FIGHTER": tournamentAction(func(_ *App, s *tournament.State, p tournamentPayload) error {
		p.Fighter.ID = p.FighterID
		return s.EditFighter(p.CategoryID, p.Fighter)
	}),
	"DELETE_FIGHTER": tournamentAction(func(_ *App, s *tournament.State, p tournamentPayload) error {
		return s.DeleteFighter(p.CategoryID, p.FighterID)
	}),
	"GENERATE_BRACKET": tournamentAction(func(a *App, s *tournament.State, p tournamentPayload) error {
		return s.GenerateBracket(p.CategoryID, p.ManualSeeding, a.rng)
	}),
	"SWAP_FIGHTERS": tournamentAction(func(_ *App, s *tournament.State, p tournamentPayload) error {
		return s.Swap(p.CategoryID, p.MatchID1, p.Slot1, p.MatchID2, p.Slot2)
	}),
	"WALKOVER": tournamentAction(func(_ *App, s *tournament.State, p tournamentPayload) error {
		return s.Walkover(p.ref(), p.WinnerID)
	}),
	// Chief judge only (§8). The pilot has no PINs yet, so this is only offered on the bracket screen.
	"CORRECT_RESULT": tournamentAction(func(a *App, s *tournament.State, p tournamentPayload) error {
		return s.CorrectResult(p.ref(), p.WinnerID, p.Reason, a.nowMs())
	}),
	"START_BRACKET_MATCH": tournamentAction(func(a *App, s *tournament.State, p tournamentPayload) error {
		return a.startBracketMatchLocked(s, p.ref())
	}),
}

// startBracketMatchLocked puts a bracket match on the ring. Refused while
// another fight is in progress (§8). Caller holds tmu.
func (a *App) startBracketMatchLocked(s *tournament.State, ref match.BracketRef) error {
	if inProgress(a.ring.Fight()) {
		return errFightInProgress
	}
	m, cat, err := s.StartMatch(ref)
	if err != nil {
		return err
	}
	cfg := cat.Format.FightConfig()
	cfg.RedName, cfg.BlueName = m.FighterRedName, m.FighterBlueName
	cfg.Category = cat.Label()
	cfg.Bracket = &ref
	old, err := a.ring.NewFight(newID("f-"), cfg)
	if err != nil {
		s.ReleaseMatch(ref)
		return nackCode(err)
	}
	if old.Config.Bracket != nil && *old.Config.Bracket != ref && !old.Result().Confirmed {
		s.ReleaseMatch(*old.Config.Bracket)
	}
	return nil
}
