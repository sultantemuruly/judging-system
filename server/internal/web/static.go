// Package web serves the built client when the server runs without nginx in
// front of it (one container on Fly.io): files from the build directory, and
// index.html for every page route so the React router can take over.
package web

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Static serves the client build in dir.
func Static(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := path.Clean("/" + r.URL.Path)
		if strings.HasPrefix(p, "/assets/") {
			// Vite names bundles by content hash, so they never change.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			files.ServeHTTP(w, r)
			return
		}
		if p != "/" && isFile(filepath.Join(dir, filepath.FromSlash(p))) {
			files.ServeHTTP(w, r)
			return
		}
		// index.html names the current bundle: phones must fetch it fresh, or
		// they keep an old app that no longer speaks the server's protocol.
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}

func isFile(name string) bool {
	info, err := os.Stat(name)
	return err == nil && !info.IsDir()
}
