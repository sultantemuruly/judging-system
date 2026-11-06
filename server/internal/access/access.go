// Package access holds the judges' seat passwords: a judge's device must give
// its seat's password to connect. A seat without a password is open.
// Only salted hashes are kept, so the saved file doesn't reveal the passwords.
package access

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
)

// Seats is the number of judge seats (1–3).
const Seats = 3

// MaxPasswordLength keeps a password a password, not a payload.
const MaxPasswordLength = 64

var (
	ErrBadSeat     = errors.New("bad_seat")
	ErrBadPassword = errors.New("bad_password")
)

// Entry is one seat's password, hashed. An empty Hash means no password.
//
// Holder is the device that last got onto the seat. It may reconnect without
// a password, also after the password is set or changed, so a judge already
// on the seat is never locked out by a Wi-Fi drop or a server restart (§9).
// Device IDs are random per browser.
type Entry struct {
	Salt   string `json:"salt,omitempty"`
	Hash   string `json:"hash,omitempty"`
	Holder string `json:"holder,omitempty"`
}

// Passwords are the seats' passwords, indexed by seat 1–3 (index 0 unused).
type Passwords struct {
	Seats [Seats + 1]Entry `json:"seats"`
}

// Set gives seat a new password; an empty password removes it.
func (p *Passwords) Set(seat int, password string) error {
	if seat < 1 || seat > Seats {
		return ErrBadSeat
	}
	if len(password) > MaxPasswordLength {
		return ErrBadPassword
	}
	holder := p.Seats[seat].Holder
	if password == "" {
		p.Seats[seat] = Entry{Holder: holder}
		return nil
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	s := hex.EncodeToString(salt)
	p.Seats[seat] = Entry{Salt: s, Hash: hash(s, password), Holder: holder}
	return nil
}

// minDeviceIDLength: shorter IDs (or the client's "no-storage" fallback) are
// not random enough to stand in for a password.
const minDeviceIDLength = 16

// IsHolder reports whether device is the one that last got onto seat.
func (p Passwords) IsHolder(seat int, device string) bool {
	if seat < 1 || seat > Seats || len(device) < minDeviceIDLength || device == "no-storage" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(device), []byte(p.Seats[seat].Holder)) == 1
}

// SetHolder records that device got onto seat; it reports whether that changed anything.
func (p *Passwords) SetHolder(seat int, device string) bool {
	if seat < 1 || seat > Seats || len(device) < minDeviceIDLength || device == "no-storage" || p.Seats[seat].Holder == device {
		return false
	}
	p.Seats[seat].Holder = device
	return true
}

// Check reports whether password opens seat. An open seat accepts anything.
func (p Passwords) Check(seat int, password string) bool {
	if seat < 1 || seat > Seats {
		return false
	}
	e := p.Seats[seat]
	if e.Hash == "" {
		return true
	}
	return subtle.ConstantTimeCompare([]byte(hash(e.Salt, password)), []byte(e.Hash)) == 1
}

// Protected says which seats (index 0 = seat 1) have a password.
func (p Passwords) Protected() [Seats]bool {
	var out [Seats]bool
	for seat := 1; seat <= Seats; seat++ {
		out[seat-1] = p.Seats[seat].Hash != ""
	}
	return out
}

func hash(salt, password string) string {
	sum := sha256.Sum256([]byte(salt + "\x00" + password))
	return hex.EncodeToString(sum[:])
}
