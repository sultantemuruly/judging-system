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

// ServeLogin is POST /api/login {login, password} → 200 {token} or 401.
// The operator's pages connect with the token (?token=…).
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
	token, ok := a.admin.Login(req.Login, req.Password)
	if !ok {
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
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(loginResponse{Token: token})
}

const adminKey = "admin"

// tooManyAttempts answers 429 with how long the admin login is locked.
func tooManyAttempts(w http.ResponseWriter, wait time.Duration) {
	w.Header().Set("Retry-After", strconv.Itoa(int((wait+time.Second-1)/time.Second)))
	http.Error(w, "too many failed logins", http.StatusTooManyRequests)
}

// clientAddr is the device's address: nginx passes it as X-Real-IP, since
// the connection itself always comes from nginx.
func clientAddr(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	return r.RemoteAddr
}

// OperatorAllowed implements ws.Handler: is token a valid admin login?
func (a *App) OperatorAllowed(token string) bool {
	return a.admin.Valid(token)
}
