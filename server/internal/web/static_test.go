package web

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func build(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "assets"), 0o755)
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>app</html>"), 0o644)
	os.WriteFile(filepath.Join(dir, "assets", "index-abc.js"), []byte("js"), 0o644)
	os.WriteFile(filepath.Join(dir, "vite.svg"), []byte("<svg/>"), 0o644)
	return dir
}

func get(h http.Handler, url string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
	return rec
}

func TestPageRoutesGetIndexUncached(t *testing.T) {
	h := Static(build(t))
	for _, url := range []string{"/", "/judge", "/judge/2", "/tournament/print/x", "/index.html"} {
		rec := get(h, url)
		if rec.Code != http.StatusOK && rec.Code != http.StatusMovedPermanently {
			t.Fatalf("%s: status %d", url, rec.Code)
		}
		if rec.Code == http.StatusOK {
			if !strings.Contains(rec.Body.String(), "app") {
				t.Errorf("%s: body %q, want index.html", url, rec.Body.String())
			}
			if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
				t.Errorf("%s: Cache-Control %q, want no-cache", url, got)
			}
		}
	}
}

func TestAssetsAreCachedForever(t *testing.T) {
	rec := get(Static(build(t)), "/assets/index-abc.js")
	if rec.Code != http.StatusOK || rec.Body.String() != "js" {
		t.Fatalf("status %d body %q", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Errorf("Cache-Control %q", rec.Header().Get("Cache-Control"))
	}
}

func TestOtherFilesAndMissingAssets(t *testing.T) {
	h := Static(build(t))
	if rec := get(h, "/vite.svg"); rec.Body.String() != "<svg/>" {
		t.Errorf("vite.svg body %q", rec.Body.String())
	}
	if rec := get(h, "/assets/gone.js"); rec.Code != http.StatusNotFound {
		t.Errorf("missing asset: status %d, want 404", rec.Code)
	}
	if rec := get(h, "/../../etc/passwd"); strings.Contains(rec.Body.String(), "root:") {
		t.Error("escaped the build directory")
	}
}
