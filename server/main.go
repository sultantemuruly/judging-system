package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"judging-server/internal/clock"
	"judging-server/internal/match"
	"judging-server/internal/ring"
	"judging-server/internal/store"
	"judging-server/internal/ws"
)

// legacyTournamentFile is where tournament data lived before the data directory.
const legacyTournamentFile = "tournament_data.json"

var (
	dataStore *store.Store
	theRing   *ring.Ring
)

// setup opens the data directory, loads the tournament and restores the fight
// that was on the ring. It is shared by main and the tests.
func setup(dataDir string, clk clock.Clock) (*ws.Hub, error) {
	st, err := store.Open(dataDir)
	if err != nil {
		return nil, err
	}
	dataStore = st
	if err := loadTournamentState(); err != nil {
		return nil, err
	}

	a := &app{}
	hub := ws.NewHub(a, nowMs)
	a.hub = hub
	go hub.Run()

	var r *ring.Ring
	r = ring.New(ring.Options{
		Clock:   clk,
		OpenLog: func(id string) (ring.Log, error) { return st.StartFight(id) },
		OnChange: func() {
			broadcastState(hub, r)
		},
		OnDecided: func(f match.Fight) {
			if f.Config.Bracket == nil {
				return
			}
			if err := CompleteBracketMatch(hub, *f.Config.Bracket, f.Result()); err != nil {
				log.Printf("bracket: %v", err)
			}
		},
	})

	theRing, a.ring = r, r

	id, events, err := st.CurrentFight()
	switch {
	case err != nil:
		log.Printf("could not read the current fight, starting a new one: %v", err)
		fallthrough
	case id == "":
		_, err = theRing.NewFight(newID("f-"), standaloneFormat)
	default:
		var l *store.FightLog
		if l, err = st.StartFight(id); err == nil {
			err = theRing.Restore(events, l, st.Heartbeat(id))
		}
		log.Printf("restored fight %s (%d events)", id, len(events))
	}
	return hub, err
}

// heartbeat records every interval that the round clock is running, so a
// restart can restore the round with the time it really ran.
func heartbeat(interval time.Duration) {
	for range time.Tick(interval) {
		if id, running := theRing.RunningFight(); running {
			if err := dataStore.WriteHeartbeat(id, nowMs()); err != nil {
				log.Printf("heartbeat: %v", err)
			}
		}
	}
}

func httpHandler(hub *ws.Hub) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", hub.ServeWS)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
	return mux
}

func main() {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "data"
	}
	hub, err := setup(dataDir, clock.Real{})
	if err != nil {
		log.Fatalf("startup: %v", err)
	}
	go heartbeat(time.Second)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Server is running at http://localhost:%s (data in %s)", port, dataDir)
	if err := http.ListenAndServe(":"+port, httpHandler(hub)); err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}
