package access

import "testing"

func TestAdminLogin(t *testing.T) {
	a := NewAdmin("admin", "pw", []byte("secret"))
	if _, ok := a.Login("admin", "wrong"); ok {
		t.Fatal("wrong password accepted")
	}
	if _, ok := a.Login("root", "pw"); ok {
		t.Fatal("wrong login accepted")
	}
	tok, ok := a.Login("admin", "pw")
	if !ok || !a.Valid(tok) {
		t.Fatal("right login refused")
	}
	if a.Valid("") || a.Valid(tok+"x") {
		t.Fatal("bad token accepted")
	}
}

func TestTokenSurvivesRestartButNotPasswordChange(t *testing.T) {
	tok, _ := NewAdmin("admin", "pw", []byte("secret")).Login("admin", "pw")
	if !NewAdmin("admin", "pw", []byte("secret")).Valid(tok) {
		t.Fatal("token lost on restart")
	}
	if NewAdmin("admin", "new", []byte("secret")).Valid(tok) {
		t.Fatal("token still valid after a password change")
	}
	if NewAdmin("admin", "pw", []byte("other")).Valid(tok) {
		t.Fatal("token valid with another secret")
	}
}

func TestNoPasswordMeansNoAdmin(t *testing.T) {
	a := NewAdmin("admin", "", []byte("secret"))
	if _, ok := a.Login("admin", ""); ok {
		t.Fatal("empty password logged in")
	}
}
