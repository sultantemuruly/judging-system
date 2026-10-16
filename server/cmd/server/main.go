// Command server runs the judging server: WebSocket at /ws, health at /health.
//
//	PORT      listen port (default 8080)
//	DATA_DIR  data directory (default ./data)
package main

import (
	"log"
	mrand "math/rand"
	"net/http"
	"os"
	"time"

	"judging-server/internal/app"
	"judging-server/internal/clock"
	"judging-server/internal/store"
)

// legacyTournamentFile is where tournament data lived before the data directory.
const legacyTournamentFile = "tournament_data.json"

func main() {
	port := env("PORT", "8080")
	dataDir := env("DATA_DIR", "data")

	st, err := store.Open(dataDir)
	if err != nil {
		log.Fatalf("data directory: %v", err)
	}
	a, err := app.New(app.Options{
		Store:                st,
		Clock:                clock.Real{},
		LegacyTournamentFile: legacyTournamentFile,
		Rand:                 mrand.New(mrand.NewSource(time.Now().UnixNano())),
	})
	if err != nil {
		log.Fatalf("startup: %v", err)
	}
	go func() {
		for range time.Tick(time.Second) {
			a.Heartbeat()
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", a.Hub().ServeWS)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	log.Printf("Server is running at http://localhost:%s (data in %s)", port, dataDir)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
