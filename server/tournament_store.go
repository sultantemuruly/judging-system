package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"sync"
	"time"

	"judging-server/internal/match"
	"judging-server/internal/ws"
)

var (
	tournamentMutex sync.RWMutex
	tournamentState TournamentState
)

// ---- Persistence ----

func saveTournamentState() {
	if err := dataStore.SaveTournament(tournamentState); err != nil {
		log.Printf("Failed to save tournament state: %v", err)
	}
}

func loadTournamentState() error {
	var state TournamentState
	ok, err := dataStore.LoadTournament(&state, legacyTournamentFile)
	if err != nil {
		return err
	}
	if !ok {
		log.Println("No saved tournament state found, starting fresh")
	}
	if state.Brackets == nil {
		state.Brackets = make(map[string]*Bracket)
	}
	if state.Categories == nil {
		state.Categories = []WeightCategory{}
	}
	for i := range state.Categories {
		state.Categories[i].Format = state.Categories[i].Format.normalized()
	}
	tournamentMutex.Lock()
	tournamentState = state
	tournamentMutex.Unlock()
	return nil
}

// ---- Broadcasting ----

// tournamentBroadcastMu and tournamentSeq order tournament frames like state frames.
var (
	tournamentBroadcastMu sync.Mutex
	tournamentSeq         int64
)

func tournamentMessage() []byte {
	tournamentBroadcastMu.Lock()
	defer tournamentBroadcastMu.Unlock()
	return tournamentMessageLocked()
}

func tournamentMessageLocked() []byte {
	tournamentMutex.RLock()
	defer tournamentMutex.RUnlock()
	tournamentSeq++
	b, err := json.Marshal(ServerMessage{Type: "TOURNAMENT_STATE_UPDATE", Payload: tournamentState, ServerTime: nowMs(), Seq: tournamentSeq})
	if err != nil {
		log.Printf("marshal tournament: %v", err)
	}
	return b
}

func BroadcastTournamentState(hub *ws.Hub) {
	tournamentBroadcastMu.Lock()
	defer tournamentBroadcastMu.Unlock()
	hub.Broadcast(tournamentMessageLocked())
}

// ---- Category CRUD ----

func addCategory(name, gender, sex, discipline string, format FightFormat) string {
	id := fmt.Sprintf("cat-%d", time.Now().UnixNano())
	tournamentState.Categories = append(tournamentState.Categories, WeightCategory{
		ID:         id,
		Name:       name,
		Gender:     gender,
		Sex:        sex,
		Discipline: discipline,
		Format:     format.normalized(),
		Fighters:   []TournamentFighter{},
	})
	return id
}

func findCategoryIndex(categoryID string) int {
	for i, c := range tournamentState.Categories {
		if c.ID == categoryID {
			return i
		}
	}
	return -1
}

func editCategory(categoryID, name, gender, sex, discipline string, format FightFormat) bool {
	idx := findCategoryIndex(categoryID)
	if idx < 0 {
		return false
	}
	tournamentState.Categories[idx].Format = format.normalized()
	tournamentState.Categories[idx].Name = name
	tournamentState.Categories[idx].Gender = gender
	tournamentState.Categories[idx].Sex = sex
	tournamentState.Categories[idx].Discipline = discipline
	return true
}

func deleteCategory(categoryID string) bool {
	idx := findCategoryIndex(categoryID)
	if idx < 0 {
		return false
	}
	tournamentState.Categories = append(tournamentState.Categories[:idx], tournamentState.Categories[idx+1:]...)
	delete(tournamentState.Brackets, categoryID)
	return true
}

// ---- Fighter CRUD ----

func addFighter(categoryID string, f TournamentFighter) bool {
	idx := findCategoryIndex(categoryID)
	if idx < 0 {
		return false
	}
	f.ID = fmt.Sprintf("f-%s-%d", categoryID, time.Now().UnixNano())
	tournamentState.Categories[idx].Fighters = append(tournamentState.Categories[idx].Fighters, f)
	return true
}

func editFighter(categoryID, fighterID string, f TournamentFighter) bool {
	catIdx := findCategoryIndex(categoryID)
	if catIdx < 0 {
		return false
	}
	for i, existing := range tournamentState.Categories[catIdx].Fighters {
		if existing.ID == fighterID {
			f.ID = fighterID
			tournamentState.Categories[catIdx].Fighters[i] = f
			return true
		}
	}
	return false
}

func deleteFighter(categoryID, fighterID string) bool {
	catIdx := findCategoryIndex(categoryID)
	if catIdx < 0 {
		return false
	}
	fighters := tournamentState.Categories[catIdx].Fighters
	for i, f := range fighters {
		if f.ID == fighterID {
			tournamentState.Categories[catIdx].Fighters = append(fighters[:i], fighters[i+1:]...)
			return true
		}
	}
	return false
}

func findFighterByID(categoryID, fighterID string) *TournamentFighter {
	catIdx := findCategoryIndex(categoryID)
	if catIdx < 0 {
		return nil
	}
	for _, f := range tournamentState.Categories[catIdx].Fighters {
		if f.ID == fighterID {
			return &f
		}
	}
	return nil
}

// ---- Seeding Algorithm ----

// nextPowerOf2 returns the next power of 2 >= n
func nextPowerOf2(n int) int {
	if n <= 1 {
		return 1
	}
	p := 1
	for p < n {
		p *= 2
	}
	return p
}

// GenerateBracket creates a seeded bracket for a weight category
func GenerateBracket(categoryID string, manualSeeding []string) bool {
	catIdx := findCategoryIndex(categoryID)
	if catIdx < 0 {
		return false
	}

	fighters := tournamentState.Categories[catIdx].Fighters
	n := len(fighters)
	if n == 0 {
		return false
	}

	bracketSize := nextPowerOf2(n)
	totalRounds := int(math.Log2(float64(bracketSize)))

	// Create slot array: slots[i] = fighter or nil (bye)
	slots := make([]*TournamentFighter, bracketSize)

	if len(manualSeeding) == bracketSize {
		// Manual seeding mode
		for i, id := range manualSeeding {
			if id != "" {
				slots[i] = findFighterByID(categoryID, id)
			}
		}
	} else {
		// Auto-seeding separated mode
		n := len(fighters)
		realMatchesCount := n - (bracketSize / 2)
		byeMatchesCount := (bracketSize / 2) - realMatchesCount

		validIndices := []int{}
		for i := 0; i < realMatchesCount; i++ {
			validIndices = append(validIndices, i*2, i*2+1)
		}
		for i := 0; i < byeMatchesCount; i++ {
			matchIdx := realMatchesCount + i
			validIndices = append(validIndices, matchIdx*2)
			// matchIdx*2+1 remains nil (BYE)
		}

		// Find champion and 2nd place
		var champion, second *TournamentFighter
		var others []*TournamentFighter

		for i := range fighters {
			f := &fighters[i]
			if f.IsPreviousChampion {
				champion = f
			} else if f.IsPreviousSecond {
				second = f
			} else {
				others = append(others, f)
			}
		}

		// If champion exists but second doesn't (or vice versa), treat them as normal
		if champion != nil && second == nil {
			others = append(others, champion)
			champion = nil
		}
		if second != nil && champion == nil {
			others = append(others, second)
			second = nil
		}

		// Place champion in first valid slot and second in opposing last valid slot
		if champion != nil && second != nil && len(validIndices) >= 2 {
			slots[validIndices[0]] = champion
			slots[validIndices[len(validIndices)-1]] = second
		}

		// Shuffle the remaining fighters
		rand.Shuffle(len(others), func(i, j int) {
			others[i], others[j] = others[j], others[i]
		})

		// Sort remaining fighters by club+city for separation algorithm
		// We use a greedy approach: place each fighter as far as possible from same-club/city
		placeFightersWithSeparation(slots, others, validIndices)
	}

	// Generate round 1 matches.
	// BYE-vs-BYE pairs are skipped entirely — no match is emitted, meaning the
	// next-round slot will be filled by cascading walkover logic below.
	matches := []BracketMatch{}
	matchCount := bracketSize / 2

	for i := 0; i < matchCount; i++ {
		redSlot := slots[i*2]
		blueSlot := slots[i*2+1]

		// Skip BYE-vs-BYE: no match needed, slot remains empty for walkover cascade
		if redSlot == nil && blueSlot == nil {
			continue
		}

		match := BracketMatch{
			ID:       fmt.Sprintf("m-%s-r1-p%d", categoryID, i),
			Round:    1,
			Position: i,
			Status:   BracketMatchPending,
		}

		if redSlot != nil {
			match.FighterRedID = redSlot.ID
			match.FighterRedName = redSlot.Name
		}
		if blueSlot != nil {
			match.FighterBlueID = blueSlot.ID
			match.FighterBlueName = blueSlot.Name
		}

		// One fighter vs BYE — mark as bye with winner already decided
		if redSlot == nil {
			match.Status = BracketMatchBye
			match.WinnerID = blueSlot.ID
		} else if blueSlot == nil {
			match.Status = BracketMatchBye
			match.WinnerID = redSlot.ID
		}

		matches = append(matches, match)
	}

	// Generate matches for subsequent rounds (empty, to be filled as winners advance)
	for round := 2; round <= totalRounds; round++ {
		roundMatches := int(math.Pow(2, float64(totalRounds-round)))
		for i := 0; i < roundMatches; i++ {
			match := BracketMatch{
				ID:       fmt.Sprintf("m-%s-r%d-p%d", categoryID, round, i),
				Round:    round,
				Position: i,
				Status:   BracketMatchPending,
			}
			matches = append(matches, match)
		}
	}

	bracket := &Bracket{
		CategoryID:  categoryID,
		Matches:     matches,
		TotalRounds: totalRounds,
		Generated:   true,
	}

	// Auto-advance byes
	advanceByes(bracket, categoryID)

	tournamentState.Brackets[categoryID] = bracket
	return true
}

// placeFightersWithSeparation places fighters into empty slots, maximizing distance
// between same-club fighters (highest priority) and same-city fighters (secondary)
func placeFightersWithSeparation(slots []*TournamentFighter, fighters []*TournamentFighter, validIndices []int) {
	if len(fighters) == 0 {
		return
	}

	// Group fighters by club and city
	// Sort by club size descending so large clubs get placed first (harder constraint)
	type group struct {
		key      string
		fighters []*TournamentFighter
	}

	clubGroups := map[string][]*TournamentFighter{}
	for _, f := range fighters {
		key := f.Club
		if key == "" {
			key = "__no_club__"
		}
		clubGroups[key] = append(clubGroups[key], f)
	}

	// Flatten: largest clubs first so they get spread out first
	var ordered []*TournamentFighter
	for {
		placed := false
		for club, grp := range clubGroups {
			if len(grp) > 0 {
				ordered = append(ordered, grp[0])
				clubGroups[club] = grp[1:]
				placed = true
			}
		}
		if !placed {
			break
		}
	}

	bracketSize := len(slots)
	// Place each fighter in the empty slot that maximizes minimum distance from same-club/city
	for _, fighter := range ordered {
		bestSlot := -1
		bestScore := -1

		for _, i := range validIndices {
			if slots[i] != nil {
				continue
			}
			score := slotScore(slots, i, fighter, bracketSize)
			if score > bestScore {
				bestScore = score
				bestSlot = i
			}
		}

		if bestSlot >= 0 {
			slots[bestSlot] = fighter
		}
	}
}

// slotScore calculates how "good" a slot is for a fighter
// Higher score = better separation from same-club (weighted 10x) and same-city fighters
func slotScore(slots []*TournamentFighter, slotIdx int, fighter *TournamentFighter, bracketSize int) int {
	minClubDist := bracketSize + 1
	minCityDist := bracketSize + 1

	for i := 0; i < bracketSize; i++ {
		if slots[i] == nil {
			continue
		}
		dist := abs(slotIdx - i)

		if slots[i].Club != "" && fighter.Club != "" && slots[i].Club == fighter.Club {
			if dist < minClubDist {
				minClubDist = dist
			}
		}
		if slots[i].City != "" && fighter.City != "" && slots[i].City == fighter.City {
			if dist < minCityDist {
				minCityDist = dist
			}
		}
	}

	// Weight club separation much more than city
	return minClubDist*10 + minCityDist
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// advanceByes auto-advances bye winners to the next round, cascading walkovers
func advanceByes(bracket *Bracket, categoryID string) {
	for _, match := range bracket.Matches {
		if match.Status == BracketMatchBye && match.WinnerID != "" {
			advanceWinner(bracket, match.Round, match.Position, match.WinnerID, getFighterName(categoryID, match.WinnerID), categoryID)
		}
	}
}

func getFighterName(categoryID, fighterID string) string {
	catIdx := findCategoryIndex(categoryID)
	if catIdx < 0 {
		return ""
	}
	for _, f := range tournamentState.Categories[catIdx].Fighters {
		if f.ID == fighterID {
			return f.Name
		}
	}
	return ""
}

// findMatch returns the index of the match at (round, position), or -1 if not found.
func findMatchIndex(bracket *Bracket, round, position int) int {
	for i, m := range bracket.Matches {
		if m.Round == round && m.Position == position {
			return i
		}
	}
	return -1
}

// feederExistsWithWinner returns true if there is a match feeding into (round, slot)
// that already has a winner (meaning a real fighter will arrive), or false if the
// feeder match does not exist (was a BYE-vs-BYE pair that was skipped).
// slot: 0 = red feeder (even child), 1 = blue feeder (odd child)
func feederExistsWithWinner(bracket *Bracket, round, position, slot int) (exists bool, winner string, winnerName string) {
	if round <= 1 {
		// Round 1 has no feeders
		return false, "", ""
	}
	feederRound := round - 1
	feederPosition := position*2 + slot
	idx := findMatchIndex(bracket, feederRound, feederPosition)
	if idx < 0 {
		// Feeder match was never created (BYE-vs-BYE skipped)
		return false, "", ""
	}
	m := bracket.Matches[idx]
	return true, m.WinnerID, func() string {
		if m.WinnerID == m.FighterRedID {
			return m.FighterRedName
		}
		return m.FighterBlueName
	}()
}

// checkAndAutoAdvance looks at a match and, if exactly one fighter is present and
// the other will never arrive (no feeder match, or feeder is empty BYE),
// declares the present fighter the winner as a walkover and cascades upward.
func checkAndAutoAdvance(bracket *Bracket, round, position int, categoryID string) {
	if round > bracket.TotalRounds {
		return
	}
	idx := findMatchIndex(bracket, round, position)
	if idx < 0 {
		return
	}
	m := bracket.Matches[idx]

	// Already decided
	if m.Status == BracketMatchCompleted || m.Status == BracketMatchBye || m.WinnerID != "" {
		return
	}

	hasRed := m.FighterRedID != ""
	hasBlue := m.FighterBlueID != ""

	if hasRed && hasBlue {
		// Both fighters present — normal match, nothing to do
		return
	}
	if !hasRed && !hasBlue {
		// Nobody here yet — could still be filled
		// Check if BOTH feeders are missing (BYE-vs-BYE on both sides)
		redFeederExists, redWinner, redWinnerName := feederExistsWithWinner(bracket, round, position, 0)
		blueFeederExists, blueWinner, blueWinnerName := feederExistsWithWinner(bracket, round, position, 1)

		// If a feeder exists but has no winner yet, we can't decide yet
		if (redFeederExists && redWinner == "") || (blueFeederExists && blueWinner == "") {
			return
		}

		if !redFeederExists && !blueFeederExists {
			// Both feeders are BYE-vs-BYE skipped — mark this match as BYE with no winner
			bracket.Matches[idx].Status = BracketMatchBye
			return
		}

		// Exactly one feeder exists with a winner — fill the appropriate slot then re-check
		if !redFeederExists && blueFeederExists && blueWinner != "" {
			bracket.Matches[idx].FighterBlueID = blueWinner
			bracket.Matches[idx].FighterBlueName = blueWinnerName
			hasBlue = true
		} else if !blueFeederExists && redFeederExists && redWinner != "" {
			bracket.Matches[idx].FighterRedID = redWinner
			bracket.Matches[idx].FighterRedName = redWinnerName
			hasRed = true
		}
		// Re-read updated state
		m = bracket.Matches[idx]
		hasRed = m.FighterRedID != ""
		hasBlue = m.FighterBlueID != ""
	}

	// At this point, exactly one slot is filled
	if hasRed && !hasBlue {
		// Check if blue feeder will ever arrive
		blueFeederExists, blueWinner, _ := feederExistsWithWinner(bracket, round, position, 1)
		if !blueFeederExists || (blueFeederExists && blueWinner == "" && round == 1) {
			// No blue feeder — walkover for red
			bracket.Matches[idx].WinnerID = m.FighterRedID
			bracket.Matches[idx].Status = BracketMatchBye
			advanceWinner(bracket, round, position, m.FighterRedID, m.FighterRedName, categoryID)
		}
		_ = blueWinner
	} else if hasBlue && !hasRed {
		// Check if red feeder will ever arrive
		redFeederExists, redWinner, _ := feederExistsWithWinner(bracket, round, position, 0)
		if !redFeederExists || (redFeederExists && redWinner == "" && round == 1) {
			// No red feeder — walkover for blue
			bracket.Matches[idx].WinnerID = m.FighterBlueID
			bracket.Matches[idx].Status = BracketMatchBye
			advanceWinner(bracket, round, position, m.FighterBlueID, m.FighterBlueName, categoryID)
		}
		_ = redWinner
	}
}

// advanceWinner places a winner into the next round's match and checks for walkovers
func advanceWinner(bracket *Bracket, fromRound, fromPosition int, winnerID, winnerName string, categoryID string) {
	nextRound := fromRound + 1
	nextPosition := fromPosition / 2

	if nextRound > bracket.TotalRounds {
		return // Tournament champion decided
	}

	// Find the next round match
	for i, match := range bracket.Matches {
		if match.Round == nextRound && match.Position == nextPosition {
			if fromPosition%2 == 0 {
				// Even position -> Red slot in next match
				bracket.Matches[i].FighterRedID = winnerID
				bracket.Matches[i].FighterRedName = winnerName
			} else {
				// Odd position -> Blue slot in next match
				bracket.Matches[i].FighterBlueID = winnerID
				bracket.Matches[i].FighterBlueName = winnerName
			}
			break
		}
	}

	// Check if the next match can be auto-resolved as a walkover
	checkAndAutoAdvance(bracket, nextRound, nextPosition, categoryID)
}

// ---- Match Integration ----

func findBracketMatch(ref match.BracketRef) (*Bracket, int) {
	bracket, ok := tournamentState.Brackets[ref.CategoryID]
	if !ok {
		return nil, -1
	}
	for i, m := range bracket.Matches {
		if m.ID == ref.MatchID {
			return bracket, i
		}
	}
	return bracket, -1
}

// StartBracketMatch starts a fight for a bracket match. Caller holds tournamentMutex.
func StartBracketMatch(hub *ws.Hub, categoryID, bracketMatchID string) bool {
	catIdx := findCategoryIndex(categoryID)
	if catIdx < 0 {
		log.Printf("Category not found: %s", categoryID)
		return false
	}
	ref := match.BracketRef{CategoryID: categoryID, MatchID: bracketMatchID}
	bracket, idx := findBracketMatch(ref)
	if idx < 0 {
		log.Printf("Bracket match not found: %s", bracketMatchID)
		return false
	}
	m := bracket.Matches[idx]
	if m.FighterRedID == "" || m.FighterBlueID == "" {
		log.Printf("Match doesn't have both fighters yet")
		return false
	}
	if m.Status == BracketMatchCompleted || m.Status == BracketMatchBye {
		log.Printf("Match already completed")
		return false
	}

	bracket.Matches[idx].Status = BracketMatchActive
	tournamentState.ActiveMatchCategoryID = categoryID
	tournamentState.ActiveMatchBracketMatchID = bracketMatchID

	cat := tournamentState.Categories[catIdx]
	cfg := cat.Format.fightConfig()
	cfg.RedName, cfg.BlueName = m.FighterRedName, m.FighterBlueName
	cfg.Category = cat.Name + " " + cat.Sex + " " + cat.Gender + " " + cat.Discipline
	cfg.Bracket = &ref
	old, err := theRing.NewFight(newID("f-"), cfg)
	if err != nil {
		log.Printf("start bracket match: %v", err)
		bracket.Matches[idx].Status = m.Status
		return false
	}
	// The replaced fight's bracket match goes back to the queue unless it was decided.
	if old.Config.Bracket != nil && *old.Config.Bracket != ref && !old.Result().Confirmed {
		releaseBracketMatchLocked(*old.Config.Bracket)
	}
	return true
}

// CompleteBracketMatch records a fight result in its bracket match and advances the winner.
func CompleteBracketMatch(hub *ws.Hub, ref match.BracketRef, res match.Result) error {
	tournamentMutex.Lock()
	bracket, idx := findBracketMatch(ref)
	if idx < 0 {
		tournamentMutex.Unlock()
		return fmt.Errorf("bracket match %s/%s not found", ref.CategoryID, ref.MatchID)
	}
	m := bracket.Matches[idx]
	if m.Status != BracketMatchActive {
		tournamentMutex.Unlock()
		return fmt.Errorf("bracket match %s is %s, not ACTIVE", m.ID, m.Status)
	}
	var winnerID, winnerName string
	switch res.Winner {
	case match.Red:
		winnerID, winnerName = m.FighterRedID, m.FighterRedName
	case match.Blue:
		winnerID, winnerName = m.FighterBlueID, m.FighterBlueName
	default:
		tournamentMutex.Unlock()
		return fmt.Errorf("bracket match %s: no winner in result %+v", m.ID, res)
	}
	bracket.Matches[idx].WinnerID = winnerID
	bracket.Matches[idx].Status = BracketMatchCompleted
	advanceWinner(bracket, m.Round, m.Position, winnerID, winnerName, ref.CategoryID)
	clearActiveMatch(ref)
	saveTournamentState()
	tournamentMutex.Unlock()

	BroadcastTournamentState(hub)
	return nil
}

// ReleaseBracketMatch puts an unfinished bracket match back to PENDING.
func ReleaseBracketMatch(hub *ws.Hub, ref match.BracketRef) {
	tournamentMutex.Lock()
	releaseBracketMatchLocked(ref)
	saveTournamentState()
	tournamentMutex.Unlock()
	BroadcastTournamentState(hub)
}

func releaseBracketMatchLocked(ref match.BracketRef) {
	bracket, idx := findBracketMatch(ref)
	if idx >= 0 && bracket.Matches[idx].Status == BracketMatchActive {
		bracket.Matches[idx].Status = BracketMatchPending
	}
	clearActiveMatch(ref)
}

func clearActiveMatch(ref match.BracketRef) {
	if tournamentState.ActiveMatchCategoryID == ref.CategoryID && tournamentState.ActiveMatchBracketMatchID == ref.MatchID {
		tournamentState.ActiveMatchCategoryID = ""
		tournamentState.ActiveMatchBracketMatchID = ""
	}
}

// SwapFighters swaps two fighters in the bracket
func SwapFighters(categoryID, matchID1 string, slot1 string, matchID2 string, slot2 string) bool {
	bracket, exists := tournamentState.Brackets[categoryID]
	if !exists {
		return false
	}

	var m1, m2 *BracketMatch
	for i, m := range bracket.Matches {
		if m.ID == matchID1 {
			m1 = &bracket.Matches[i]
		}
		if m.ID == matchID2 {
			m2 = &bracket.Matches[i]
		}
	}

	if m1 == nil || m2 == nil {
		return false
	}

	// Get fighter info from slot1
	var id1, name1 string
	if slot1 == "red" {
		id1, name1 = m1.FighterRedID, m1.FighterRedName
	} else {
		id1, name1 = m1.FighterBlueID, m1.FighterBlueName
	}

	// Get fighter info from slot2
	var id2, name2 string
	if slot2 == "red" {
		id2, name2 = m2.FighterRedID, m2.FighterRedName
	} else {
		id2, name2 = m2.FighterBlueID, m2.FighterBlueName
	}

	// Swap
	if slot1 == "red" {
		m1.FighterRedID, m1.FighterRedName = id2, name2
	} else {
		m1.FighterBlueID, m1.FighterBlueName = id2, name2
	}

	if slot2 == "red" {
		m2.FighterRedID, m2.FighterRedName = id1, name1
	} else {
		m2.FighterBlueID, m2.FighterBlueName = id1, name1
	}

	return true
}

// SetMatchWinner manually overrides a match winner
func SetMatchWinner(categoryID, matchID, winnerID string) bool {
	bracket, exists := tournamentState.Brackets[categoryID]
	if !exists {
		return false
	}

	for i, match := range bracket.Matches {
		if match.ID == matchID {
			// Verify winner is one of the fighters
			var winnerName string
			if winnerID == match.FighterRedID {
				winnerName = match.FighterRedName
			} else if winnerID == match.FighterBlueID {
				winnerName = match.FighterBlueName
			} else {
				return false
			}

			bracket.Matches[i].WinnerID = winnerID
			bracket.Matches[i].Status = BracketMatchCompleted

			// Advance winner
			advanceWinner(bracket, match.Round, match.Position, winnerID, winnerName, categoryID)
			return true
		}
	}
	return false
}

// ---- Tournament Action Processing ----

func ProcessTournamentAction(hub *ws.Hub, msg ClientMessage) error {
	tournamentMutex.Lock()
	defer tournamentMutex.Unlock()

	payloadBytes, _ := json.Marshal(msg.Payload)
	changed := false

	switch msg.Type {

	case "ADD_CATEGORY":
		var p struct {
			Name       string `json:"name"`
			Gender     string `json:"gender"`
			Sex        string `json:"sex"`
			Discipline string `json:"discipline"`
			FightFormat
		}
		if err := json.Unmarshal(payloadBytes, &p); err == nil && p.Name != "" {
			addCategory(p.Name, p.Gender, p.Sex, p.Discipline, p.FightFormat)
			changed = true
		}

	case "EDIT_CATEGORY":
		var p struct {
			CategoryID string `json:"category_id"`
			Name       string `json:"name"`
			Gender     string `json:"gender"`
			Sex        string `json:"sex"`
			Discipline string `json:"discipline"`
			FightFormat
		}
		if err := json.Unmarshal(payloadBytes, &p); err == nil {
			if editCategory(p.CategoryID, p.Name, p.Gender, p.Sex, p.Discipline, p.FightFormat) {
				changed = true
			}
		}

	case "DELETE_CATEGORY":
		var p struct {
			CategoryID string `json:"category_id"`
		}
		if err := json.Unmarshal(payloadBytes, &p); err == nil {
			if deleteCategory(p.CategoryID) {
				changed = true
			}
		}

	case "ADD_FIGHTER":
		var p struct {
			CategoryID string            `json:"category_id"`
			Fighter    TournamentFighter `json:"fighter"`
		}
		if err := json.Unmarshal(payloadBytes, &p); err == nil {
			if addFighter(p.CategoryID, p.Fighter) {
				changed = true
			}
		}

	case "EDIT_FIGHTER":
		var p struct {
			CategoryID string            `json:"category_id"`
			FighterID  string            `json:"fighter_id"`
			Fighter    TournamentFighter `json:"fighter"`
		}
		if err := json.Unmarshal(payloadBytes, &p); err == nil {
			if editFighter(p.CategoryID, p.FighterID, p.Fighter) {
				changed = true
			}
		}

	case "DELETE_FIGHTER":
		var p struct {
			CategoryID string `json:"category_id"`
			FighterID  string `json:"fighter_id"`
		}
		if err := json.Unmarshal(payloadBytes, &p); err == nil {
			if deleteFighter(p.CategoryID, p.FighterID) {
				changed = true
			}
		}

	case "GENERATE_BRACKET":
		var p struct {
			CategoryID    string   `json:"category_id"`
			ManualSeeding []string `json:"manual_seeding"`
		}
		if err := json.Unmarshal(payloadBytes, &p); err == nil {
			if GenerateBracket(p.CategoryID, p.ManualSeeding) {
				changed = true
			}
		}

	case "START_BRACKET_MATCH":
		var p struct {
			CategoryID string `json:"category_id"`
			MatchID    string `json:"match_id"`
		}
		if err := json.Unmarshal(payloadBytes, &p); err == nil {
			if StartBracketMatch(hub, p.CategoryID, p.MatchID) {
				changed = true
				// Also broadcast the match state update
				tournamentMutex.Unlock()
				BroadcastState(hub)
				tournamentMutex.Lock()
			}
		}

	case "SWAP_FIGHTERS":
		var p struct {
			CategoryID string `json:"category_id"`
			MatchID1   string `json:"match_id_1"`
			Slot1      string `json:"slot_1"` // "red" or "blue"
			MatchID2   string `json:"match_id_2"`
			Slot2      string `json:"slot_2"` // "red" or "blue"
		}
		if err := json.Unmarshal(payloadBytes, &p); err == nil {
			if SwapFighters(p.CategoryID, p.MatchID1, p.Slot1, p.MatchID2, p.Slot2) {
				changed = true
			}
		}

	case "SET_MATCH_WINNER":
		var p struct {
			CategoryID string `json:"category_id"`
			MatchID    string `json:"match_id"`
			WinnerID   string `json:"winner_id"`
		}
		if err := json.Unmarshal(payloadBytes, &p); err == nil {
			if SetMatchWinner(p.CategoryID, p.MatchID, p.WinnerID) {
				changed = true
			}
		}
	}

	if !changed {
		return errRejected
	}
	saveTournamentState()
	tournamentMutex.Unlock()
	BroadcastTournamentState(hub)
	tournamentMutex.Lock()
	return nil
}
