package access

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestAdminCheck(t *testing.T) {
	a := NewAdmin("admin", "pw", []byte("secret"))
	if a.Check("admin", "wrong") || a.Check("root", "pw") {
		t.Fatal("wrong login or password accepted")
	}
	if !a.Check("admin", "pw") {
		t.Fatal("right login refused")
	}
	if NewAdmin("admin", "", []byte("secret")).Check("admin", "") {
		t.Fatal("empty password logged in")
	}
}

func TestFingerprintFollowsPassword(t *testing.T) {
	a := NewAdmin("admin", "pw", []byte("secret"))
	if a.Fingerprint() != NewAdmin("admin", "pw", []byte("secret")).Fingerprint() {
		t.Fatal("fingerprint not stable across restarts")
	}
	if a.Fingerprint() == NewAdmin("admin", "new", []byte("secret")).Fingerprint() {
		t.Fatal("fingerprint ignores the password")
	}
	if strings.Contains(a.Fingerprint(), "pw") {
		t.Fatal("fingerprint reveals the password")
	}
}

func TestSessionLivesWhileUsed(t *testing.T) {
	var s Sessions
	now := time.Unix(1000, 0)
	tok, err := s.Issue(now)
	if err != nil {
		t.Fatal(err)
	}
	// Used every 11 h, it never ends.
	for range 5 {
		now = now.Add(11 * time.Hour)
		if !s.Use(tok, now) {
			t.Fatal("a session in use expired")
		}
	}
	if s.Use(tok, now.Add(SessionIdle)) {
		t.Fatal("an idle session still works")
	}
	if s.Use("", now) || s.Use("forged", now) {
		t.Fatal("bad token accepted")
	}
}

func TestLogoutEndsOnlyThatSession(t *testing.T) {
	var s Sessions
	now := time.Unix(1000, 0)
	laptop, _ := s.Issue(now)
	tablet, _ := s.Issue(now)
	if !s.Revoke(laptop) || s.Use(laptop, now) {
		t.Fatal("logged-out session still works")
	}
	if !s.Use(tablet, now) {
		t.Fatal("logging out one device ended another")
	}
}

func TestNewPasswordEndsAllSessions(t *testing.T) {
	s := Sessions{}
	s.ForAccount("fp-1")
	now := time.Unix(1000, 0)
	tok, _ := s.Issue(now)
	if s.ForAccount("fp-1") || !s.Use(tok, now) {
		t.Fatal("same account ended its sessions")
	}
	if !s.ForAccount("fp-2") || s.Use(tok, now) {
		t.Fatal("a new password kept old sessions")
	}
}

func TestSavedSessionsHoldNoTokens(t *testing.T) {
	var s Sessions
	tok, _ := s.Issue(time.Unix(1000, 0))
	b, _ := json.Marshal(s)
	if strings.Contains(string(b), tok) {
		t.Fatal("token saved in plain text")
	}
	var back Sessions
	json.Unmarshal(b, &back)
	if !back.Use(tok, time.Unix(1001, 0)) {
		t.Fatal("session lost in a save/load round trip")
	}
}
