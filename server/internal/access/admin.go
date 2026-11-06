package access

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
)

// Admin is the one operator/admin account. Logging in gives a token signed
// with a secret kept in the data directory, so a token survives server
// restarts and stops working as soon as the login or password changes.
type Admin struct {
	login, password string
	secret          []byte
}

func NewAdmin(login, password string, secret []byte) Admin {
	return Admin{login: login, password: password, secret: secret}
}

// Login returns the token for the right login and password.
func (a Admin) Login(login, password string) (string, bool) {
	// Compare digests, so the time taken doesn't reveal the lengths.
	okLogin := equalDigest(login, a.login)
	okPassword := equalDigest(password, a.password)
	if !okLogin || !okPassword || a.password == "" {
		return "", false
	}
	return a.token(), true
}

// Valid reports whether token came from Login with the current account.
func (a Admin) Valid(token string) bool {
	if a.password == "" || token == "" {
		return false
	}
	return hmac.Equal([]byte(token), []byte(a.token()))
}

// LoginMatches reports whether login is the admin login (for logging only).
func (a Admin) LoginMatches(login string) bool { return equalDigest(login, a.login) }

func equalDigest(x, y string) bool {
	hx, hy := sha256.Sum256([]byte(x)), sha256.Sum256([]byte(y))
	return subtle.ConstantTimeCompare(hx[:], hy[:]) == 1
}

func (a Admin) token() string {
	m := hmac.New(sha256.New, a.secret)
	m.Write([]byte("admin\x00" + a.login + "\x00" + a.password))
	return hex.EncodeToString(m.Sum(nil))
}
