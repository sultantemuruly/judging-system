// Package store keeps everything on disk under one data directory:
//
//	fights/<fightID>.jsonl  append-only event log of each fight, one event per line
//	current_fight           ID of the fight on the ring, so a restart can replay it
//	heartbeat               "<fightID> <ms>": last moment the round clock was seen running
//	tournament.json         categories and brackets, replaced atomically on each save
package store

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"judging-server/internal/match"
)

const (
	fightsDir      = "fights"
	currentFile    = "current_fight"
	heartbeatFile  = "heartbeat"
	tournamentFile = "tournament.json"
)

type Store struct {
	dir string
}

// Open creates the data directory if needed.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(dir, fightsDir), 0o755); err != nil {
		return nil, err
	}
	return &Store{dir: dir}, nil
}

func (s *Store) Dir() string { return s.dir }

func (s *Store) fightPath(id string) string {
	return filepath.Join(s.dir, fightsDir, filepath.Base(id)+".jsonl")
}

// FightLog appends events of one fight. Every Append is synced to disk
// before it returns, so an acknowledged event survives a crash.
type FightLog struct {
	mu sync.Mutex
	f  *os.File
}

// StartFight opens (or creates) the log of a fight and makes it the current fight.
func (s *Store) StartFight(id string) (*FightLog, error) {
	f, err := os.OpenFile(s.fightPath(id), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, err
	}
	if err := WriteFileAtomic(filepath.Join(s.dir, currentFile), []byte(id)); err != nil {
		f.Close()
		return nil, err
	}
	return &FightLog{f: f}, nil
}

func (l *FightLog) Append(e match.Event) error {
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, err := l.f.Write(append(b, '\n')); err != nil {
		return err
	}
	return l.f.Sync()
}

func (l *FightLog) Close() error { return l.f.Close() }

// CurrentFight returns the ID and events of the fight that was on the ring,
// or an empty ID if there is none. A torn last line (crash mid-write) is dropped.
func (s *Store) CurrentFight() (string, []match.Event, error) {
	b, err := os.ReadFile(filepath.Join(s.dir, currentFile))
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, err
	}
	id := strings.TrimSpace(string(b))
	events, err := s.ReadFight(id)
	return id, events, err
}

func (s *Store) ReadFight(id string) ([]match.Event, error) {
	data, err := os.ReadFile(s.fightPath(id))
	if err != nil {
		return nil, err
	}
	lines := bytes.Split(data, []byte("\n"))
	var events []match.Event
	for i, line := range lines {
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var e match.Event
		if err := json.Unmarshal(line, &e); err != nil {
			if i == len(lines)-1 { // no trailing newline: the write was cut off
				log.Printf("store: dropping torn last line of fight %s", id)
				break
			}
			return nil, fmt.Errorf("fight %s line %d: %w", id, i+1, err)
		}
		events = append(events, e)
	}
	return events, nil
}

// WriteHeartbeat records that the fight's round clock was running at atMs.
func (s *Store) WriteHeartbeat(fightID string, atMs int64) error {
	return WriteFileAtomic(filepath.Join(s.dir, heartbeatFile), fmt.Appendf(nil, "%s %d", fightID, atMs))
}

// Heartbeat returns the last time the clock of fightID was seen running, or 0.
func (s *Store) Heartbeat(fightID string) int64 {
	b, err := os.ReadFile(filepath.Join(s.dir, heartbeatFile))
	if err != nil {
		return 0
	}
	var id string
	var at int64
	if _, err := fmt.Sscanf(string(b), "%s %d", &id, &at); err != nil || id != fightID {
		return 0
	}
	return at
}

// SaveTournament writes the tournament state atomically.
func (s *Store) SaveTournament(v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return WriteFileAtomic(filepath.Join(s.dir, tournamentFile), b)
}

// LoadTournament reads the tournament state into v. If the data directory has
// none yet, it imports legacyPath once (the old tournament_data.json).
// It reports whether anything was loaded.
func (s *Store) LoadTournament(v any, legacyPath string) (bool, error) {
	b, err := os.ReadFile(filepath.Join(s.dir, tournamentFile))
	if errors.Is(err, fs.ErrNotExist) && legacyPath != "" {
		if b, err = os.ReadFile(legacyPath); err == nil {
			log.Printf("store: importing %s into %s", legacyPath, s.dir)
		}
	}
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, json.Unmarshal(b, v)
}

// WriteFileAtomic replaces path with data: write a temp file in the same
// directory, sync it, then rename over the old file. A failure at any point
// leaves the old file as it was.
func WriteFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
