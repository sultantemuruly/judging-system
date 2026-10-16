# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Real-time judging system for amateur kickboxing tournaments (K-1 / Low-kick, WAKO-style). Three side judges tap RED / BLUE on their phones for every clean hit; an operator laptop runs the clock and enters referee decisions (warnings, knockdowns, stoppages); a viewer screen shows the scoreboard; an admin manages categories, fighters and single-elimination brackets. Status: pilot. The club's #1 requirement is that judges' phones stay connected and no tap is lost.

**`TECHNICAL_SPECIFICATION.md` (Russian) is the source of truth for all rules** — scoring, warnings ladder, knockdowns, tie-breaks, bracket behaviour, reliability requirements. Its section 10 lists worked scenarios with expected results; each must exist as an automated test. When code and spec disagree, the spec wins; if the spec is silent or ambiguous, ask rather than invent a rule.

## Commands

Server (Go, module `judging-server`, Go 1.25):
```bash
cd server
go run ./cmd/server               # http://localhost:8080, /ws and /health; PORT, DATA_DIR env vars
go build ./... && go vet ./...
go test ./...                     # all tests
go test ./... -run TestSpec -v    # the spec §10 scenarios
go test -race ./...               # concurrency changes must pass this
```
The server keeps its data in `DATA_DIR` (default `./data`, gitignored): one JSONL event log per fight, `current_fight`, `heartbeat`, `tournament.json`. On first start it imports an old `tournament_data.json` from the working directory. Run experiments with a scratch `DATA_DIR`, not the repo's.

Client (React 19 + TypeScript + Vite 7 + Tailwind 4):
```bash
cd client
npm install
npm run dev      # http://localhost:5173 (listens on all interfaces so phones on the LAN can connect)
npm run build    # tsc -b && vite build → client/dist
npm run lint
npm test         # vitest
```
In dev the client connects to `ws://<host>:8080/ws` directly; on HTTPS it uses `wss://<host>/ws` through nginx (`client/nginx.conf`). The page decides the connection's role: `/judge/N` is judge seat N, `/viewer` a viewer, anything else the operator.

Docker (`docker-compose.yml`) is still broken: the builder image is `golang:1.21` while `go.mod` needs 1.25, the client image expects a pre-built `client/dist`, and compose bind-mounts a single `tournament_data.json` file — mount the data directory instead (atomic writes rename files inside it). Fix it before relying on it.

## Architecture

Server — pure domain logic separated from I/O:
```
server/
  cmd/server/main.go        wiring only: config, store, app, HTTP routes, heartbeat ticker
  internal/match/           fight domain: events, Apply (validate + fold), scoring, tie-breaks, clock rules, FightView — pure
  internal/tournament/      categories, fighters, seeding, bracket advancement, walkover, result correction, placings — pure
  internal/ring/            the fight on the ring: validate → append to log → commit → re-arm the 0:00 alarm → notify
  internal/store/           data directory: per-fight JSONL log, heartbeat, atomic tournament.json; recovery reads
  internal/ws/              hub, client pumps, sessions (role/seat/device), seat takeover, ACK/NACK, protocol types
  internal/clock/           real and fake clocks, Alarm
  internal/app/             decodes actions, checks roles, links fights to the bracket, broadcasts state
```
- **Server is authoritative.** It owns the clock, computes every score and verdict, and broadcasts a computed `FightView` (`STATE_UPDATE`) and the tournament (`TOURNAMENT_STATE_UPDATE`). Clients never recompute scores. State frames carry `seq` (clients drop older ones) and every frame carries `server_time`.
- **Fight state = fold over an event log.** Hits, undos, warnings, knockdowns, stoppages, decisions, confirmation are events with an ID, actor and server time; undo is an event (`HitUndone`, `RefereeActionUndone`), not a deletion. `match.Apply` returns a new fight or an error and leaves the input unchanged. Every accepted event is fsynced before it is applied and broadcast; a restart replays the log and restores a running round paused.
- **Actions** are `{id, type, payload, client_time?, offline?}`; the server answers `ACK`/`NACK{reason}`. A client action ID becomes the event ID, so resends are not applied twice (also across restarts). A judge's seat comes from the connection, never the payload. Judges' unconfirmed actions are queued in localStorage and resent marked `offline`; offline taps are judged by their device time converted to server time.
- **Fight ↔ bracket.** `START_BRACKET_MATCH` puts a match on the ring (refused while another fight is in progress); the bracket advances only when the operator confirms the result. A fight replaced before confirmation returns its match to PENDING. Locks: tournament lock (`App.tmu`) before the ring lock; ring callbacks run outside the ring lock.
- Domain packages take time as a parameter (no `time.Now()` inside), so tests are deterministic. Tests named `TestSpec_SNN_*` mirror the spec's §10 scenarios one-to-one.

Client — feature folders, thin pages:
```
client/src/
  api/          socket (roles, reconnect, ACKs, clock sync), offline queue, protocol types (mirror Go structs)
  features/
    judge/      judge screen
    operator/   operator dashboard, split into small components
    viewer/     spectator screen
    tournament/ setup, brackets, schedule, bracket PDF (/tournament/print/:categoryId)
  shared/       NavBar (operator pages), ScoreDiffBar, ConfirmDialog, server-synced countdown hooks, result labels
```
- Components only render server state and dispatch actions; no business rules in TSX (e.g. "next warning disqualifies" comes from the view).
- One display component per concept (e.g. the score-difference bar), not copies per page.

Known gaps (pilot scope, spec §0):
- No PINs/auth: any device can open any page; result correction is "chief judge only" only by being on the bracket screen.
- `MatchSchedule.tsx` priorities are hardcoded to one past tournament's categories.
- Wake Lock needs HTTPS; on plain-HTTP LAN judges must disable auto-lock.

## Conventions

- Keep files and functions small and single-purpose; split a file when it mixes concerns rather than when it hits a line count.
- Protocol message types are defined once per side (Go `internal/ws`, TS `api/`) and must stay in sync — change both in the same commit.
- Rule constants (points per minus point, knockdown limits, undo window, grace period after the gong) live in one place in `internal/match`, named after the spec.
