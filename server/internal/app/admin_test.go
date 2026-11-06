package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"judging-server/internal/ws"
)

func TestOperatorNeedsAdminLogin(t *testing.T) {
	url, _, _ := wsServer(t)
	for _, q := range []string{"role=operator", "role=operator&token=forged", "", "role=nonsense"} {
		c := dial(t, url, q)
		f := c.next("first frame", func(ws.Frame) bool { return true })
		if f.Type != ws.TypeAdminAuthFailed {
			t.Fatalf("%q: operator connected without logging in (got %s)", q, f.Type)
		}
	}
	op := dialOperator(t, url)
	if f := op.next("first frame", func(ws.Frame) bool { return true }); f.Type == ws.TypeAdminAuthFailed {
		t.Fatal("logged-in operator refused")
	}
}

func TestViewerAndJudgesNeedNoAdminLogin(t *testing.T) {
	url, _, _ := wsServer(t)
	for _, q := range []string{"role=viewer", "role=judge&seat=1&device=a"} {
		f := dial(t, url, q).next("first frame", func(ws.Frame) bool { return true })
		if f.Type == ws.TypeAdminAuthFailed || f.Type == ws.TypeJudgeAuthFailed {
			t.Fatalf("%s refused", q)
		}
	}
}

func login(t *testing.T, a *App, body string) (int, string) {
	t.Helper()
	w := httptest.NewRecorder()
	a.ServeLogin(w, httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(body)))
	var r loginResponse
	json.Unmarshal(w.Body.Bytes(), &r)
	return w.Code, r.Token
}

func TestLoginEndpoint(t *testing.T) {
	a, _, _ := newTestApp(t)
	code, tok := login(t, a, `{"login":"admin","password":"test-password"}`)
	if code != http.StatusOK || !a.OperatorAllowed(tok) {
		t.Fatalf("right login: %d, token valid %v", code, a.OperatorAllowed(tok))
	}
	if code, tok := login(t, a, `{"login":"admin","password":"nope"}`); code != http.StatusUnauthorized || tok != "" {
		t.Fatalf("wrong password: %d %q", code, tok)
	}
	w := httptest.NewRecorder()
	a.ServeLogin(w, httptest.NewRequest(http.MethodGet, "/api/login", nil))
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET: %d", w.Code)
	}
}

func TestAdminStaysLoggedInAcrossRestart(t *testing.T) {
	a, clk, dir := newTestApp(t)
	tok := adminToken(t, a)
	a.Close()
	if !openApp(t, dir, clk).OperatorAllowed(tok) {
		t.Fatal("restart logged the operator out")
	}
}
