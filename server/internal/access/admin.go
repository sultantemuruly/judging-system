package access

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
)

// Admin is the one operator/admin account, from the server's environment.
type Admin struct {
	login, password string
	secret          []byte
}

// NewAdmin: secret is a random key kept in the data directory; it makes the
// account's fingerprint unguessable.
func NewAdmin(login, password string, secret []byte) Admin {
	return Admin{login: login, password: password, secret: secret}
}

// Check reports whether login and password are the account's. Digests are
// compared, so the time taken doesn't reveal their lengths.
func (a Admin) Check(login, password string) bool {
	okLogin := equalDigest(login, a.login)
	okPassword := equalDigest(password, a.password)
	return okLogin && okPassword && a.password != ""
}

// LoginMatches reports whether login is the admin login (for logging only).
func (a Admin) LoginMatches(login string) bool { return equalDigest(login, a.login) }

// Fingerprint identifies the current login and password without revealing
// them: when it changes, every admin session ends.
func (a Admin) Fingerprint() string {
	m := hmac.New(sha256.New, a.secret)
	m.Write([]byte("admin\x00" + a.login + "\x00" + a.password))
	return hex.EncodeToString(m.Sum(nil))
}

func equalDigest(x, y string) bool {
	hx, hy := sha256.Sum256([]byte(x)), sha256.Sum256([]byte(y))
	return subtle.ConstantTimeCompare(hx[:], hy[:]) == 1
}
