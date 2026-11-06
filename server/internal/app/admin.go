package app

import (
	"encoding/json"
	"log"
	"net/http"
	"time"
)

// failedLoginDelay slows down guessing the admin password.
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
	token, ok := a.admin.Login(req.Login, req.Password)
	if !ok {
		log.Printf("admin: failed login as %q from %s", req.Login, r.RemoteAddr)
		time.Sleep(failedLoginDelay)
		http.Error(w, "wrong login or password", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(loginResponse{Token: token})
}

// OperatorAllowed implements ws.Handler: is token a valid admin login?
func (a *App) OperatorAllowed(token string) bool {
	return a.admin.Valid(token)
}
