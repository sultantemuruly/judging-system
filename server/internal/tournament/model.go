// Package tournament is categories, fighters, seeding and single-elimination
// brackets (spec §8). It is pure: callers pass in IDs, time and randomness.
package tournament

import (
	"errors"

	"judging-server/internal/match"
)

// Rejection reasons; the message is the NACK code.
var (
	ErrNotFound          = errors.New("not_found")
	ErrInvalid           = errors.New("invalid")
	ErrLocked            = errors.New("bracket_locked")
	ErrNoFighters        = errors.New("no_fighters")
	ErrMatchNotReady     = errors.New("match_not_ready")
	ErrMatchDecided      = errors.New("match_decided")
	ErrMatchNotCompleted = errors.New("match_not_completed")
	ErrNextMatchStarted  = errors.New("next_match_started")
	ErrBadWinner         = errors.New("bad_winner")
	ErrBadReason         = errors.New("bad_reason")
	ErrMatchOnRing       = errors.New("match_on_ring")
)

// Fighter is a fighter registered in a category.
type Fighter struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	City               string `json:"city"`
	Club               string `json:"club"`
	IsPreviousChampion bool   `json:"is_previous_champion"`
	IsPreviousSecond   bool   `json:"is_previous_second"`
}

// Category is a weight category.
type Category struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Gender     string    `json:"gender"`     // age group; only "Seniors" (17+) at this tournament
	Sex        string    `json:"sex"`        // "male" or "female"
	Discipline string    `json:"discipline"` // one of Disciplines
	Format     Format    `json:"format"`
	Fighters   []Fighter `json:"fighters"`
}

// Disciplines the club runs: Low-kick and K-1. No full-contact, so no kick counter.
var Disciplines = map[string]bool{"low-kick": true, "k-1": true}

// Label is the category's display name for scoreboards.
func (c Category) Label() string {
	return c.Name + " " + c.Sex + " " + c.Gender + " " + c.Discipline
}

// Format is a category's fight format (§2) and knockdown limits (§5).
type Format struct {
	Rounds       int `json:"rounds"`
	RoundSeconds int `json:"round_seconds"`
	RestSeconds  int `json:"rest_seconds"`
	KDLimitRound int `json:"kd_limit_round"`
	KDLimitFight int `json:"kd_limit_fight"`
}

func (f Format) FightConfig() match.FightConfig {
	return match.FightConfig{
		Rounds: f.Rounds, RoundSeconds: f.RoundSeconds, RestSeconds: f.RestSeconds,
		KDLimitRound: f.KDLimitRound, KDLimitFight: f.KDLimitFight,
	}.WithDefaults()
}

// Normalized fills unset values with the defaults.
func (f Format) Normalized() Format {
	c := f.FightConfig()
	return Format{c.Rounds, c.RoundSeconds, c.RestSeconds, c.KDLimitRound, c.KDLimitFight}
}

type MatchStatus string

const (
	Pending   MatchStatus = "PENDING"
	Active    MatchStatus = "ACTIVE"
	Completed MatchStatus = "COMPLETED"
	Bye       MatchStatus = "BYE" // decided without a fight: a bye or a walkover cascade
)

// Match is one bracket match.
type Match struct {
	ID              string      `json:"id"`
	Round           int         `json:"round"`    // 1-based
	Position        int         `json:"position"` // 0-based within the round
	FighterRedID    string      `json:"fighter_red_id"`
	FighterBlueID   string      `json:"fighter_blue_id"`
	FighterRedName  string      `json:"fighter_red_name"`
	FighterBlueName string      `json:"fighter_blue_name"`
	WinnerID        string      `json:"winner_id"`
	Status          MatchStatus `json:"status"`
	// How the match was won (§5) and the judges' votes for PTS, e.g. "2:1".
	Method      match.Method `json:"method,omitempty"`
	Votes       string       `json:"votes,omitempty"`
	FightID     string       `json:"fight_id,omitempty"`
	Corrections []Correction `json:"corrections,omitempty"`
}

// Correction records a result changed by the chief judge (§8, WAKO art. 12).
type Correction struct {
	At          int64  `json:"at"`
	OldWinnerID string `json:"old_winner_id"`
	NewWinnerID string `json:"new_winner_id"`
	Reason      string `json:"reason"`
}

// Correction reasons allowed by §8.
var CorrectionReasons = map[string]bool{"corners_switched": true, "operator_error": true, "protest": true}

func (m Match) hasBoth() bool { return m.FighterRedID != "" && m.FighterBlueID != "" }

func (m Match) nameOf(id string) string {
	if id == m.FighterRedID {
		return m.FighterRedName
	}
	if id == m.FighterBlueID {
		return m.FighterBlueName
	}
	return ""
}

func (m Match) loserID() string {
	if m.WinnerID == m.FighterRedID {
		return m.FighterBlueID
	}
	return m.FighterRedID
}

// Bracket is a category's single-elimination bracket.
type Bracket struct {
	CategoryID  string   `json:"category_id"`
	Matches     []Match  `json:"matches"`
	TotalRounds int      `json:"total_rounds"`
	Generated   bool     `json:"generated"`
	Locked      bool     `json:"locked"`   // a fight was decided or is on the ring: no regeneration, no fighter changes (§8)
	Placings    Placings `json:"placings"` // filled as results come in
}

// Placings are 1st, 2nd and both losing semi-finalists 3rd (§8). IDs; "" while unknown.
type Placings struct {
	First  string   `json:"first"`
	Second string   `json:"second"`
	Third  []string `json:"third"`
}

// State is the whole tournament.
type State struct {
	Name                      string              `json:"name"`
	Date                      string              `json:"date"`
	Categories                []Category          `json:"categories"`
	Brackets                  map[string]*Bracket `json:"brackets"` // by category ID
	ActiveMatchCategoryID     string              `json:"active_match_category_id"`
	ActiveMatchBracketMatchID string              `json:"active_match_bracket_match_id"`
}

// Normalize makes a loaded state safe to use.
func (s *State) Normalize() {
	if s.Categories == nil {
		s.Categories = []Category{}
	}
	if s.Brackets == nil {
		s.Brackets = map[string]*Bracket{}
	}
	for i := range s.Categories {
		s.Categories[i].Format = s.Categories[i].Format.Normalized()
		if s.Categories[i].Fighters == nil {
			s.Categories[i].Fighters = []Fighter{}
		}
	}
	for _, b := range s.Brackets {
		b.refresh()
	}
}
