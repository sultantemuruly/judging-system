package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func getSeats(t *testing.T, a *App) judgeSeats {
	t.Helper()
	rec := httptest.NewRecorder()
	a.ServeSeats(rec, httptest.NewRequest(http.MethodGet, "/api/seats", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var s judgeSeats
	if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSeatsSaysWhichAreTaken(t *testing.T) {
	a, _, _ := newTestApp(t)
	if s := getSeats(t, a); s != (judgeSeats{}) {
		t.Fatalf("fresh app: %+v, want nothing taken", s)
	}
	a.ring.SetSeats([4]bool{false, false, true, false})
	want := judgeSeats{Occupied: [3]bool{false, true, false}}
	if s := getSeats(t, a); s != want {
		t.Fatalf("got %+v, want %+v", s, want)
	}
}

func TestSeatsIsReadOnly(t *testing.T) {
	a, _, _ := newTestApp(t)
	rec := httptest.NewRecorder()
	a.ServeSeats(rec, httptest.NewRequest(http.MethodPost, "/api/seats", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST: status %d", rec.Code)
	}
}
