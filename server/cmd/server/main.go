// Command server runs the judging server: WebSocket at /ws, admin login and
// logout at /api/login and /api/logout, health at /health.
//
//	PORT            listen port (default 8080)
//	DATA_DIR        data directory (default ./data)
//	ADMIN_LOGIN     operator/admin login (default admin)
//	ADMIN_PASSWORD  operator/admin password (required)
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
	adminLogin := env("ADMIN_LOGIN", "admin")
	adminPassword := os.Getenv("ADMIN_PASSWORD")
	if adminPassword == "" {
		log.Fatal("ADMIN_PASSWORD is not set: without it nobody can open the operator's pages")
	}

	st, err := store.Open(dataDir)
	if err != nil {
		log.Fatalf("data directory: %v", err)
	}
	a, err := app.New(app.Options{
		Store:                st,
		Clock:                clock.Real{},
		LegacyTournamentFile: legacyTournamentFile,
		Rand:                 mrand.New(mrand.NewSource(time.Now().UnixNano())),
		AdminLogin:           adminLogin,
		AdminPassword:        adminPassword,
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
	mux.HandleFunc("/api/login", a.ServeLogin)
	mux.HandleFunc("/api/logout", a.ServeLogout)
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
