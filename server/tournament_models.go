package main

// TournamentFighter represents a fighter registered in a weight category
type TournamentFighter struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	City               string `json:"city"`
	Club               string `json:"club"`
	IsPreviousChampion bool   `json:"is_previous_champion"`
	IsPreviousSecond   bool   `json:"is_previous_second"`
}

// WeightCategory represents a weight class division
type WeightCategory struct {
	ID         string              `json:"id"`
	Name       string              `json:"name"`
	Gender     string              `json:"gender"`     // "Men" or "Cadets"
	Sex        string              `json:"sex"`        // "male" or "female"
	Discipline string              `json:"discipline"` // "low-kick", "full-contact", "k-1"
	Fighters   []TournamentFighter `json:"fighters"`
}

// BracketMatchStatus represents the status of a bracket match
type BracketMatchStatus string

const (
	BracketMatchPending   BracketMatchStatus = "PENDING"
	BracketMatchActive    BracketMatchStatus = "ACTIVE"
	BracketMatchCompleted BracketMatchStatus = "COMPLETED"
	BracketMatchBye       BracketMatchStatus = "BYE"
)

// BracketMatch represents a single match in the bracket
type BracketMatch struct {
	ID             string             `json:"id"`
	Round          int                `json:"round"`    // 1-based round number
	Position       int                `json:"position"` // Position within the round (0-based)
	FighterRedID   string             `json:"fighter_red_id"`
	FighterBlueID  string             `json:"fighter_blue_id"`
	FighterRedName string             `json:"fighter_red_name"`
	FighterBlueName string            `json:"fighter_blue_name"`
	WinnerID       string             `json:"winner_id"`
	Status         BracketMatchStatus `json:"status"`
}

// Bracket represents the complete bracket for a weight category
type Bracket struct {
	CategoryID  string         `json:"category_id"`
	Matches     []BracketMatch `json:"matches"`
	TotalRounds int            `json:"total_rounds"`
	Generated   bool           `json:"generated"`
}

// TournamentState holds the entire tournament state
type TournamentState struct {
	Categories                []WeightCategory   `json:"categories"`
	Brackets                  map[string]*Bracket `json:"brackets"` // keyed by category ID
	ActiveMatchCategoryID     string             `json:"active_match_category_id"`
	ActiveMatchBracketMatchID string             `json:"active_match_bracket_match_id"`
}
