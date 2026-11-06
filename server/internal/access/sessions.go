package access

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"time"
)

// SessionIdle — an admin session ends after this long without being used.
// Every connection of the operator's pages uses it, so it lasts through a
// tournament day and is gone by the next one.
const SessionIdle = 12 * time.Hour

// Sessions are the admin's logins, one per device. Only hashes of the tokens
// are kept, so the saved file doesn't let anyone in. Not safe for concurrent
// use; time is passed in.
type Sessions struct {
	// Fingerprint of the account the sessions belong to (Admin.Fingerprint).
	Fingerprint string `json:"fingerprint"`
	// Expires maps a token's hash to when it ends (ms since the epoch).
	Expires map[string]int64 `json:"expires"`
}

// ForAccount ends every session if they belong to another login or password.
func (s *Sessions) ForAccount(fingerprint string) (changed bool) {
	if s.Fingerprint == fingerprint {
		return false
	}
	*s = Sessions{Fingerprint: fingerprint}
	return true
}

// Issue starts a session and returns its token.
func (s *Sessions) Issue(now time.Time) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	s.prune(now)
	if s.Expires == nil {
		s.Expires = map[string]int64{}
	}
	token := hex.EncodeToString(b)
	s.Expires[tokenHash(token)] = now.Add(SessionIdle).UnixMilli()
	return token, nil
}

// Use reports whether token is a live session, and keeps it alive.
func (s *Sessions) Use(token string, now time.Time) bool {
	if token == "" {
		return false
	}
	h := tokenHash(token)
	exp, ok := s.Expires[h]
	if !ok || now.UnixMilli() >= exp {
		delete(s.Expires, h)
		return false
	}
	s.Expires[h] = now.Add(SessionIdle).UnixMilli()
	return true
}

// Revoke ends token's session (logging out on that device).
func (s *Sessions) Revoke(token string) bool {
	h := tokenHash(token)
	_, ok := s.Expires[h]
	delete(s.Expires, h)
	return ok
}

func (s *Sessions) prune(now time.Time) {
	for h, exp := range s.Expires {
		if now.UnixMilli() >= exp {
			delete(s.Expires, h)
		}
	}
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
