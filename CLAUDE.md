# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Real-time judging system for amateur kickboxing tournaments (Low-kick only, WAKO-style). Three side judges tap RED / BLUE on their phones for every clean hit; an operator laptop runs the clock and enters referee decisions (warnings, knockdowns, stoppages); a viewer screen shows the scoreboard; an admin manages categories, fighters and single-elimination brackets. Status: pilot. The club's #1 requirement is that judges' phones stay connected and no tap is lost.

**`TECHNICAL_SPECIFICATION.md` (Russian) is the source of truth for all rules** — scoring, warnings ladder, knockdowns, tie-breaks, bracket behaviour, reliability requirements. Its section 10 lists worked scenarios with expected results; each must exist as an automated test. When code and spec disagree, the spec wins; if the spec is silent or ambiguous, ask rather than invent a rule.

## Commands

Server (Go, module `judging-server`, Go 1.25):
```bash
cd server
ADMIN_PASSWORD=… go run ./cmd/server   # http://localhost:8080: /ws, /api/login, /api/logout, /api/seats, /health; PORT, DATA_DIR, ADMIN_LOGIN (default admin), ADMIN_PASSWORD (required)
go build ./... && go vet ./...
go test ./...                     # all tests
go test ./... -run TestSpec -v    # the spec §10 scenarios
go test -race ./...               # concurrency changes must pass this
```
The server keeps its data in `DATA_DIR` (default `./data`, gitignored): one JSONL event log per fight, `current_fight`, `heartbeat`, `tournament.json`, `judge_passwords.json` (salted hashes; kept out of `tournament.json` because every device receives that), `admin_secret` (key behind the admin account's fingerprint), `admin_sessions.json` (hashed admin session tokens and their expiry). On first start it imports an old `tournament_data.json` from the working directory. Run experiments with a scratch `DATA_DIR`, not the repo's.

Client (React 19 + TypeScript + Vite 7 + Tailwind 4):
```bash
cd client
npm install
npm run dev      # http://localhost:5173 (listens on all interfaces so phones on the LAN can connect)
npm run build    # tsc -b && vite build → client/dist
npm run lint
npm test         # vitest
```
The Vite dev server connects to `ws://<host>:8080/ws` directly and proxies `/api` to `:8080`; the built app always uses the same origin, `ws(s)://<host>/ws`, through nginx (`client/nginx.conf`). The page decides the connection's role: `/judge/N` is judge seat N, `/viewer` and the judge picker `/judge` are viewers, anything else the operator.

Docker (`docker-compose.yml`): copy `.env.example` to `.env` and set `ADMIN_PASSWORD` (the repo is public: never commit the real one), then `docker compose up --build -d`, then open `http://<this machine>/` on every device (`HTTP_PORT` changes the port). nginx serves the client and proxies `/ws` to the server, whose port isn't published. Data lives in the named volume `judging-data` (mounted at `/app/data`), so it survives `docker compose down` and rebuilds; `down -v` deletes it. To import an old `tournament_data.json` into an empty volume: `docker compose create`, `docker compose cp server/tournament_data.json server:/app/data/tournament.json`, `docker compose run --rm --no-deps -u root --entrypoint chown server appuser /app/data/tournament.json` (the copy keeps your host uid, which the server's `appuser` can't read), then `docker compose up -d`.

Fly.io (online, HTTPS): the root `Dockerfile` builds one image with both halves; the Go server also serves the client build when `STATIC_DIR` is set (`internal/web`), so there is no nginx. `fly.toml` runs exactly one always-on machine (never more: the fight lives in one process) with the volume `judging_data` at `/app/data`; set the password with `fly secrets set ADMIN_PASSWORD=…`. The root `.dockerignore` keeps `.env` and data out of the build.

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
  internal/access/          judges' seat passwords (salted hashes, check) — pure
  internal/clock/           real and fake clocks, Alarm
  internal/web/             serves the client build when there is no nginx (Fly.io)
  internal/app/             decodes actions, checks roles, links fights to the bracket, broadcasts state
```
- **Server is authoritative.** It owns the clock, computes every score and verdict, and broadcasts a computed `FightView` (`STATE_UPDATE`) and the tournament (`TOURNAMENT_STATE_UPDATE`). Clients never recompute scores. State frames carry `seq` (clients drop older ones) and every frame carries `server_time`.
- **Fight state = fold over an event log.** Hits, undos, warnings, knockdowns, stoppages, decisions, confirmation are events with an ID, actor and server time; undo is an event (`HitUndone`, `RefereeActionUndone`), not a deletion. `match.Apply` returns a new fight or an error and leaves the input unchanged. Every accepted event is fsynced before it is applied and broadcast; a restart replays the log and restores a running round paused.
- **Connecting:** the URL carries only `role` and `seat`; the first frame a client sends is `HELLO {device, password?, token?}` (judge seat password / admin session token), so nothing secret is in URLs that proxies log. A connection without HELLO within 5 s is dropped.
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
- Judge seats can have passwords (set under Categories → Judge passwords, `SET_JUDGE_PASSWORD`). The server checks one when a judge's device connects (in `HELLO`) and answers a wrong one with `JUDGE_AUTH_FAILED` and a close; the phone remembers it in localStorage and stays locked, not reconnecting, until a new one is typed. Queued taps survive the lock. The device that last got onto a seat (its random device ID, saved as `holder` in `judge_passwords.json`) reconnects without a password, also after the password changes or the server restarts, so a judge on the seat is never locked out by a Wi-Fi drop; other devices need the password. 5 wrong passwords lock a seat for 30 s (doubling, max 10 min; `access.Limiter`), but never lock out its holder. Spec §0 left PINs out of the pilot; this was added on the club's request. The start screen (the locked operator page: «Главный судья» + «Судья 1–3») and `/judge` ask `GET /api/seats` which seats have a password and which have a phone on them, and confirm before taking an occupied seat, since taking it disconnects that phone.
- Operator/admin pages need the admin login: `POST /api/login` starts a session per device and returns its token; the page connects with it in `HELLO`, and without a live one gets `ADMIN_AUTH_FAILED` and the login screen. A session ends after 12 h unused (each connection renews it), on Log out (`POST /api/logout`), and for every device when the admin login or password changes. Failed logins wait 1 s one after another (not in parallel), and 5 lock the login (429 + `Retry-After`). One shared account, no roles: result correction is "chief judge only" only by being on the bracket screen. Viewer pages are open.
- `MatchSchedule.tsx` priorities are hardcoded to one past tournament's categories.
- Wake Lock needs HTTPS; on plain-HTTP LAN judges must disable auto-lock.

## Conventions

- Keep files and functions small and single-purpose; split a file when it mixes concerns rather than when it hits a line count.
- Protocol message types are defined once per side (Go `internal/ws`, TS `api/`) and must stay in sync — change both in the same commit.
- Rule constants (points per minus point, knockdown limits, undo window, grace period after the gong) live in one place in `internal/match`, named after the spec.
