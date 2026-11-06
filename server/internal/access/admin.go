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
	okLogin := subtle.ConstantTimeCompare([]byte(login), []byte(a.login)) == 1
	okPassword := subtle.ConstantTimeCompare([]byte(password), []byte(a.password)) == 1
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

func (a Admin) token() string {
	m := hmac.New(sha256.New, a.secret)
	m.Write([]byte("admin\x00" + a.login + "\x00" + a.password))
	return hex.EncodeToString(m.Sum(nil))
}
