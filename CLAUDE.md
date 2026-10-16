# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Real-time judging system for amateur kickboxing tournaments (K-1 / Low-kick, WAKO-style). Three side judges tap RED / BLUE on their phones for every clean hit; an operator laptop runs the clock and enters referee decisions (warnings, knockdowns, stoppages); a viewer screen shows the scoreboard; an admin manages categories, fighters and single-elimination brackets. Status: pilot. The club's #1 requirement is that judges' phones stay connected and no tap is lost.

**`TECHNICAL_SPECIFICATION.md` (Russian) is the source of truth for all rules** — scoring, warnings ladder, knockdowns, tie-breaks, bracket behaviour, reliability requirements. Its section 10 lists worked scenarios with expected results; each must exist as an automated test. When code and spec disagree, the spec wins; if the spec is silent or ambiguous, ask rather than invent a rule.

## Commands

Server (Go, module `judging-server`, Go 1.25):
```bash
cd server
go run .                          # http://localhost:8080, /ws and /health
go build ./... && go vet ./...
go test ./...                     # all tests
go test ./... -run TestName -v    # single test
go test -race ./...               # concurrency changes must pass this
```
The server writes `tournament_data.json` into its working directory (gitignored) — run experiments from a scratch directory, not the repo.

Client (React 19 + TypeScript + Vite 7 + Tailwind 4):
```bash
cd client
npm install
npm run dev      # http://localhost:5173 (listens on all interfaces so phones on the LAN can connect)
npm run build    # tsc -b && vite build → client/dist
npm run lint
```
There is no client test runner yet. In dev the client connects to `ws://<host>:8080/ws` directly; on HTTPS it uses `wss://<host>/ws` through nginx (`client/nginx.conf`).

Docker (`docker-compose.yml`) is currently broken: the builder image is `golang:1.21` while `go.mod` needs 1.25, and the client image expects a pre-built `client/dist`. Fix it before relying on it.

## Current architecture (as inherited)

- **One WebSocket, full-state broadcast.** Clients send `{type, payload}` actions; the server mutates global state and broadcasts the *entire* state to every client as `STATE_UPDATE` (current fight) or `TOURNAMENT_STATE_UPDATE` (categories + brackets). `writePump` batches queued messages into one frame separated by `\n`; `client/src/socket.ts` splits on newlines.
- **Two global stores, two mutexes.** `store.go` holds the single current fight (`appState`, `stateMutex`) and routes tournament action types to `tournament_store.go` (`tournamentState`, `tournamentMutex`). Functions unlock mid-way to broadcast and re-lock for the deferred unlock — be careful when touching this pattern.
- **Fight ↔ bracket link.** `START_BRACKET_MATCH` resets the fight state with the bracket fighters' names; when the fight ends (after round 3, TKO or DQ) `CompleteBracketMatch` runs in a goroutine and advances the winner via `advanceWinner` / `checkAndAutoAdvance` (bye/walkover cascade).
- **Persistence.** Only the tournament is saved to `tournament_data.json`; the current fight lives in memory.
- **Client.** `App.tsx` owns both states and passes them to route pages: `/` operator dashboard, `/judge/:id`, `/viewer`, `/tournament/*`. Every page renders from props; actions go through `sendAction`.

Known defects to keep in mind (fix them, don't build on them):
- `CompleteBracketMatch` treats any non-`Red` winner (including `Draw`) as Blue.
- `CalculateMatchWinner` returns early when no judge pressed anything, leaving the bracket match ACTIVE forever; judges with zero taps are excluded from the vote.
- Rounds end only because the Dashboard tab sends `END_ROUND` from a browser timer; timers compare device clocks with server timestamps.
- `maxMessageSize = 512` in `client.go` closes the socket on larger actions (e.g. manual seeding of more than ~10 fighters).
- Judge taps sent while disconnected are silently dropped; there is no ack, no judge undo UI, no undo for warnings/knockdowns.
- Scoring logic is duplicated in `store.go`, `Dashboard.tsx` and `ViewerScreen.tsx`.
- No auth: any client can send any action; two devices on `/judge/1` double-count.
- `MatchSchedule.tsx` priorities are hardcoded to one past tournament's categories.

## Target architecture (refactor towards this)

Migrate incrementally — keep the app runnable after every step, and land each step with tests.

Server — pure domain logic separated from I/O:
```
server/
  cmd/server/main.go        wiring only: config, store, hub, HTTP routes
  internal/match/           fight domain: events, state reducer, scoring, tie-breaks, round clock rules — pure, no I/O, no goroutines
  internal/tournament/      categories, fighters, seeding, bracket advancement, result correction — pure
  internal/store/           persistence: append-only event log + snapshots on disk; recovery on restart
  internal/ws/              hub, client pumps, protocol message types, per-action acks and idempotency keys
  internal/clock/           server-side round/rest timer that emits round-end events
```
- **Server is authoritative.** It owns the clock, computes every score and verdict, and sends computed results. Clients never recompute scores.
- **Fight state = fold over an event log.** Hits, undos, warnings, knockdowns, start/pause/end are events with an ID, author and server timestamp; undo is an event, not a deletion. This gives persistence, undo and audit from one mechanism.
- Every client action carries a client-generated ID; the server acks it and ignores duplicates (offline queue on judges' phones relies on this).
- Domain packages take time as a parameter (no `time.Now()` inside), so tests are deterministic.
- Table-driven tests in `internal/match` mirror the spec's section-10 scenarios one-to-one.

Client — feature folders, thin pages:
```
client/src/
  api/          socket connection, reconnect, offline action queue, protocol types (mirror Go structs)
  features/
    judge/      judge screen
    operator/   operator dashboard
    viewer/     spectator screen
    tournament/ setup, brackets, schedule, PDF export
  shared/       reusable components (score bars, timer display), hooks (server-synced countdown)
```
- Components only render server state and dispatch actions; no business rules in TSX.
- One display component per concept (e.g. the score-difference bar), not copies per page.

## Conventions

- Keep files and functions small and single-purpose; split a file when it mixes concerns rather than when it hits a line count.
- Protocol message types are defined once per side (Go `internal/ws`, TS `api/`) and must stay in sync — change both in the same commit.
- Rule constants (points per minus point, knockdown limits, undo window, grace period after the gong) live in one place in `internal/match`, named after the spec.
