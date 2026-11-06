package app

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"judging-server/internal/access"
)

// failedLoginDelay: each failed admin login holds up the next login attempt this long.
const failedLoginDelay = time.Second

type loginRequest struct {
	Login    string `json:"login"`
	Password string `json:"password"`
}

type loginResponse struct {
	Token string `json:"token"`
}

// ServeLogin is POST /api/login {login, password} → 200 {token}, 401, or 429
// while locked. Each login is its own session; the operator's pages connect
// with its token (in the HELLO frame).
func (a *App) ServeLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req loginRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	a.loginMu.Lock()
	defer a.loginMu.Unlock()
	if wait := a.adminLimits.LockedFor(adminKey, a.clock.Now()); wait > 0 {
		tooManyAttempts(w, wait)
		return
	}
	if !a.admin.Check(req.Login, req.Password) {
		// The login itself isn't logged: people type the password there by mistake.
		log.Printf("admin: failed login (login matched: %v) from %s", a.admin.LoginMatches(req.Login), clientAddr(r))
		wait := a.adminLimits.Fail(adminKey, a.clock.Now())
		time.Sleep(a.loginDelay)
		if wait > 0 {
			log.Printf("admin: %d failed logins, locked for %v", access.MaxFailures, wait)
			tooManyAttempts(w, wait)
			return
		}
		http.Error(w, "wrong login or password", http.StatusUnauthorized)
		return
	}
	a.adminLimits.Succeed(adminKey)
	token, err := a.newAdminSession()
	if err != nil {
		log.Printf("admin: start session: %v", err)
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(loginResponse{Token: token})
}

const adminKey = "admin"

// tooManyAttempts answers 429 with how long the admin login is locked.
func tooManyAttempts(w http.ResponseWriter, wait time.Duration) {
	w.Header().Set("Retry-After", strconv.Itoa(int((wait+time.Second-1)/time.Second)))
	http.Error(w, "too many failed logins", http.StatusTooManyRequests)
}

// clientAddr is the device's address, for the log: Fly.io's proxy passes it as
// Fly-Client-IP and nginx as X-Real-IP, since the connection itself comes
// from the proxy.
func clientAddr(r *http.Request) string {
	if ip := r.Header.Get("Fly-Client-IP"); ip != "" {
		return ip
	}
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	return r.RemoteAddr
}

type logoutRequest struct {
	Token string `json:"token"`
}

// ServeLogout is POST /api/logout {token}: ends that device's session.
func (a *App) ServeLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req logoutRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	a.smu.Lock()
	if a.sessions.Revoke(req.Token) {
		a.saveSessionsLocked()
	}
	a.smu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

// OperatorAllowed implements ws.Handler: is token a live admin session? Using
// it keeps it alive (access.SessionIdle).
func (a *App) OperatorAllowed(token string) bool {
	a.smu.Lock()
	defer a.smu.Unlock()
	if !a.sessions.Use(token, a.clock.Now()) {
		return false
	}
	a.saveSessionsLocked()
	return true
}

func (a *App) newAdminSession() (string, error) {
	a.smu.Lock()
	defer a.smu.Unlock()
	token, err := a.sessions.Issue(a.clock.Now())
	if err != nil {
		return "", err
	}
	return token, a.store.SaveAdminSessions(a.sessions)
}

// loadAdminSessions reads the sessions; a new login or password ends them all.
func (a *App) loadAdminSessions() error {
	a.smu.Lock()
	defer a.smu.Unlock()
	if _, err := a.store.LoadAdminSessions(&a.sessions); err != nil {
		return err
	}
	if a.sessions.ForAccount(a.admin.Fingerprint()) {
		return a.store.SaveAdminSessions(a.sessions)
	}
	return nil
}

// saveSessionsLocked saves the sessions; a failed save only costs that a
// restart forgets the latest change. Caller holds smu.
func (a *App) saveSessionsLocked() {
	if err := a.store.SaveAdminSessions(a.sessions); err != nil {
		log.Printf("save admin sessions: %v", err)
	}
}
