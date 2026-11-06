package ws

import (
	"net/http/httptest"
	"testing"
)

func TestSessionFromQuery(t *testing.T) {
	cases := []struct {
		query string
		want  Session
	}{
		{"role=judge&seat=2&device=a", Session{Role: RoleJudge, Seat: 2, Device: "a"}},
		{"role=judge&seat=4", Session{Role: RoleViewer}},
		{"role=judge", Session{Role: RoleViewer}},
		{"role=viewer", Session{Role: RoleViewer}},
		{"", Session{Role: RoleOperator}},
		{"role=admin", Session{Role: RoleOperator}},
	}
	for _, tc := range cases {
		got := SessionFromQuery(httptest.NewRequest("GET", "/ws?"+tc.query, nil))
		if got != tc.want {
			t.Errorf("%q: got %+v, want %+v", tc.query, got, tc.want)
		}
	}
}
