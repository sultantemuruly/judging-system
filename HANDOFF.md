# Handoff: bring the codebase in line with the spec

For a coding agent continuing this work. Read [CLAUDE.md](CLAUDE.md) and [TECHNICAL_SPECIFICATION.md](TECHNICAL_SPECIFICATION.md) (Russian) before starting. Spec sections are cited below as **§N**; worked scenarios as **S1–S18** (spec §10).

## Context

- Kickboxing tournament judging app (Go server + React client), forked from an earlier attempt that "didn't work well" in use. This is a **pilot** for a club; the club president's one hard requirement: **judges join from their phones and the connection never loses a tap.** He also requires a **bracket PDF for the chief judge and secretary to sign** (§8).
- The spec was rewritten from WAKO rules (sources at the end of the spec). Decisions already made with the user — do not reopen them:
  - Stay on Go + React. No Next.js / Vercel rewrite.
  - Scoring: every clean hit = +1, cumulative over the whole fight per judge; no "per exchange" scoring, no "strong hit +3", no "simultaneous hits", no "last hit wins" (§3, §6).
  - Warnings: 2nd and 3rd official warning = −3 at every judge, 4th = DQ (§4). Knockdown = −1 to the downed fighter at every judge (§5).
  - Exactly 3 judges. A judge always produces a winner (tie → last round → judge's own decision). No draws (§6, §7).
  - Server is authoritative for clock, scores and verdicts (§9).
- Nothing in the codebase has tests yet. Both halves build; `npm run lint` reports 6 errors.

## How to work

- One step per branch/PR, in order. Each step leaves the app runnable end-to-end (operator, judges, viewer, brackets).
- Follow the target layout in CLAUDE.md (`server/internal/{match,tournament,store,ws,clock}`, `client/src/{api,features,shared}`). Move code into it as you touch it; don't do a big-bang move.
- Domain packages are pure: no I/O, no goroutines, time passed in as a parameter.
- Every spec scenario listed under a step becomes a named test (e.g. `TestSpec_S03_TwoWarningsCostThreePoints`).
- Before finishing a step: `go vet ./...`, `go test -race ./...`, `npm run build`, `npm run lint` (no new errors), and a manual run with the operator dashboard, viewer and three judge tabs.
- When the spec is silent or ambiguous, stop and ask the user. Open questions are listed at the end.

## Current defects (where to look)

| Defect | Location | Fixed in |
| --- | --- | --- |
| Draw advances the Blue corner in the bracket | `CompleteBracketMatch` [tournament_store.go:679](server/tournament_store.go#L679) | 1 |
| No taps at all → no winner, bracket match stuck ACTIVE; judges with 0 taps excluded from vote | `CalculateMatchWinner` [store.go:119](server/store.go#L119) | 1 |
| Knockdowns don't affect score; tie-break by round order differs from spec | [store.go:119](server/store.go#L119), `KNOCKDOWN` case [store.go:356](server/store.go#L356) | 1 |
| Scoring duplicated in client | `computePerJudgeScores` [Dashboard.tsx:86](client/src/Dashboard.tsx#L86), [ViewerScreen.tsx:62](client/src/ViewerScreen.tsx#L62) | 1 |
| Rounds end only via the operator browser's timer; device clocks vs server timestamps | [Dashboard.tsx:63](client/src/Dashboard.tsx#L63) | 2 |
| Current fight kept in memory only; tournament file written non-atomically | [store.go](server/store.go), `saveTournamentState` [tournament_store.go:39](server/tournament_store.go#L39) | 2 |
| Taps while disconnected are dropped silently; no ack | `sendAction` [socket.ts:167](client/src/socket.ts#L167) | 3 |
| 512-byte read limit kills the socket (e.g. manual seeding > ~10 fighters) | [client.go:16](server/client.go#L16) | 3 |
| No judge undo UI; undo only while running; two devices on one seat double-count | [JudgeScreen.tsx](client/src/JudgeScreen.tsx), `UNDO_HIT` [store.go:331](server/store.go#L331) | 3 |
| No undo for warnings / knockdowns; 4th warning DQs and advances instantly | `OFFICIAL_WARNING` [store.go:397](server/store.go#L397) | 4 |
| Starting a bracket match mid-fight wipes it; old match stays ACTIVE | `StartBracketMatch` [tournament_store.go:623](server/tournament_store.go#L623) | 5 |
| Bracket can be regenerated after results; `SET_MATCH_WINNER` ignores already-played downstream matches | `GenerateBracket` [tournament_store.go:202](server/tournament_store.go#L202), `SetMatchWinner` [tournament_store.go:781](server/tournament_store.go#L781) | 5 |
| No PDF export | — | 5 |

## Core design (introduced in step 1, relied on by 2–5)

**A fight is an append-only list of events; its state is a fold over them.**

- Event envelope: `ID` (client-generated action ID, or server-generated for server events), `Type`, `Actor` (operator / judge seat 1–3 / system), `ServerTime`, type-specific payload.
- Event types (suggested): `FightCreated` (fighters, category, rounds, round/rest duration), `RoundStarted`, `ClockPaused`, `ClockResumed`, `RoundEnded`, `Hit` (seat, corner), `HitUndone` (seat), `OfficialWarning` (corner), `MinusPoint` (corner), `Knockdown` (corner), `Stoppage` (winner, method KO/RSC/DQ/AB/WO), `RefereeActionUndone` (target event ID), `JudgeDecision` (seat, corner), `ResultConfirmed`.
- `Apply(state, event) (state, error)` validates against the rules (e.g. hits only while the clock runs; judge undo only during the round or within 10 s after the gong) and rejects invalid events without changing state.
- Derived view, computed on the server and broadcast to clients: clock state, per-judge score per round and total, warnings/minus points/knockdowns per corner, knockdown-limit flag, each judge's verdict (or "awaiting decision"), fight result (winner, method, 3:0 / 2:1), whether the result is confirmed. Clients render this view and never recompute it. Broadcast the view, not the raw log.
- Rule constants live in one file in `internal/match`, named after the spec: minus point = 3, knockdown = 1, knockdown limits 3 per round / 4 per fight, judge undo window 10 s, gong grace 0.5 s, judges = 3.

---

## Step 1. Fight domain: `internal/match`

Spec: §3, §4, §5, §6, §7. Scenarios: **S1–S9, S13, S18** (S10's undo window at the domain level as well).

Tasks:
1. Create `server/internal/match` with the event types, `Apply`, the derived view and the rule constants above.
2. Scoring per §6: judge total = hits − 3 × minus points − 1 × knockdowns; higher total wins; on a tie compare that judge's last-round score; still tied (including a judge who pressed nothing) → verdict is "awaiting judge decision" until a `JudgeDecision` arrives.
3. Warning ladder per §4: 2nd and 3rd official warnings each add a minus point; the 4th sets result DQ for the opponent. A direct `MinusPoint` is separate and does not advance the warning count.
4. Knockdowns per §5: −1 each; expose `KnockdownLimitReached` when one fighter has 3 in the current round or 4 in the fight. The domain only flags it; the operator decides (step 4).
5. Fight result per §7: majority of 3 judge verdicts, or the stoppage result. Never "Draw".
6. Wire it in: replace the fight logic in `store.go` (`CalculateMatchWinner`, the `ProcessAction` cases, `models.go` match structs) with the domain. Keep the existing message type names where possible so the client keeps working. The round clock still ends via the client in this step; step 2 moves it.
7. Bracket advancement only receives Red or Blue. Advance when the result is final; step 4 changes this to "when confirmed".
8. Client: Dashboard and Viewer render the server view; delete `computePerJudgeScores` from both. Extract the score-difference bar into one shared component.

Acceptance: table-driven tests for S1–S9, S13, S18 pass. Manual: a fight with equal totals no longer sends Blue through, and a fight with no taps still produces a winner via the judge decision.

## Step 2. Server clock and persistence

Spec: §2, §9 (Время, Данные). Scenarios: **S12, S17**.

Tasks:
1. `internal/clock`: server-side timer driven by fight state. It emits `RoundEnded` at 0:00, runs the rest period automatically, and flags "Seconds out" 10 s before the rest ends. Use an injectable clock so tests can advance time.
2. Remove the client-sent `END_ROUND` from the Dashboard timer. The manual end-round button stays as an operator action.
3. Clock sync: every server message carries `server_time`. The client keeps an offset and shows countdowns from server time (target: screens within 0.2 s). Put this in one shared hook used by every screen.
4. `internal/store`: append each fight event to disk before applying and broadcasting (e.g. JSONL per fight in a data directory). Write the tournament state atomically (temp file + rename).
5. Recovery on startup: replay the current fight's log. If a round was running at the crash, restore it **paused** with elapsed time preserved (§9).
6. Per-category fight format (§2): category holds rounds, round duration, rest duration; a bracket fight takes its format from the category. Defaults: 3 × 2 min, 1 min rest. The global "Settings" dialog goes away or becomes the category editor.

Acceptance: S12 and S17 tests pass (S17 = rebuild state from a written log). Manual: close the operator tab mid-round, the round still ends at 0:00 on the viewer and judges; kill and restart the server mid-round, the fight resumes paused with the same score.

## Step 3. Judge connectivity

Spec: §1 (one seat = one device, all 3 connected before start), §3 (acceptance window, undo), §9 (Связь). Scenarios: **S10, S11, S15, S16**.

Tasks:
1. Protocol: every client action is `{id, type, payload}`. The server answers `ACK {id}` or `NACK {id, reason}`. A repeated `id` is acknowledged again but not re-applied (check against IDs in the event log).
2. Raise the read limit (e.g. 64 KB) and log rejected frames instead of silently dropping the connection.
3. Judge session: the judge connects as seat 1–3 (link / QR to `/judge/1` etc.). A new connection for the same seat takes it over and closes the old one with a reason the old screen displays (S15). The server tracks which seats are connected and includes it in the view.
4. Offline queue in `client/src/api`: unacked actions are kept (survive a page reload) and resent in order after reconnect. Each queued hit carries its device time converted to server time via the clock offset.
5. Hit acceptance (§3): online hits count if received ≤ 0.5 s after the gong (S16); hits from the offline queue count if their converted device time falls inside a running interval of that round (S11).
6. Judge undo (§3): button removes that judge's last hit; allowed during the round and up to 10 s after the gong (S10).
7. Judge screen: shows only the judge's own score; vibrate on **ACK**, not on tap; red "Нет связи" banner while disconnected; buttons disabled unless the clock runs. Request a Screen Wake Lock when available (needs HTTPS; otherwise judges disable auto-lock).
8. Operator: indicator per judge seat. Start is disabled until all 3 seats are connected (§1).

Acceptance: S10, S11, S15, S16 tests pass. Manual: turn off Wi-Fi on a judge phone for 20 s mid-round, tap 4 times, reconnect; exactly 4 hits appear.

## Step 4. Operator workflow

Spec: §4, §5, §6 (judge decision screen), §7 (confirmation), §2 (medical timeout).

Tasks:
1. Undo for referee actions: the operator can undo any warning / minus point / knockdown / stoppage until the result is confirmed (`RefereeActionUndone`). The log keeps both events (S13 at the UI level).
2. Confirmation dialog before a 4th warning or direct DQ.
3. When `KnockdownLimitReached` is set, prompt the operator to stop the fight (RSC). Show the "one more = stoppage" warning after the 2nd knockdown in a round.
4. Stoppage control: choose winner and method (KO / RSC / DQ / AB).
5. Judge decision screen: when a judge's verdict is "awaiting decision", their phone shows a mandatory RED / BLUE choice.
6. "Confirm result" button. Only after confirmation does the viewer show the winner and the bracket advance.
7. Medical timeout: separate 2-minute timer the operator starts and stops.
8. Move the operator dashboard into `client/src/features/operator`, split into small components (clock controls, referee actions, judge cards, result panel).

Acceptance: a whole fight can be run, mistakes corrected and the result confirmed without editing data by hand; the bracket advances only on confirmation.

## Step 5. Tournament and bracket PDF

Spec: §8. Scenario: **S14**.

Tasks:
1. Move seeding and advancement into `server/internal/tournament` as pure functions. Add tests for the current behaviour first (champion and runner-up in opposite halves, club then city separation, byes only in round 1, walkover cascade), then change it.
2. Lock a category's bracket once any of its fights is completed: no regeneration, no adding or removing fighters.
3. Only one active fight: reject `START_BRACKET_MATCH` while a fight is in progress or awaiting confirmation; the operator can explicitly cancel an unstarted fight.
4. Walkover: "WO win" for a bracket match without running a fight.
5. Result correction (S14): only the chief judge, with a reason (corners switched / operator error / protest). Allowed only if the winner's next match hasn't started; then the downstream slot is updated. The old result and reason are kept.
6. Placings: final winner 1st, finalist 2nd, both semi-final losers 3rd. No 3rd-place fight.
7. **Bracket PDF** (mandatory): per category, A4. Shows the full bracket with each match's winner and method, the placings, tournament name and date, and signature lines "Главный судья ________" and "Секретарь ________". Simplest route: a print-optimised page (`/tournament/print/:categoryId`, `@media print`, A4 page size) and the browser's "Save as PDF". Use a PDF library only if the print layout can't fit large brackets.
8. Move tournament screens into `client/src/features/tournament`. Keep `MatchSchedule` working as-is (its rework is out of pilot scope, §0).

Acceptance: S14 tests pass; tournament tests cover seeding and advancement; the PDF of a 16-fighter category fits A4 and prints with signature lines.

---

## Spec scenario → step

| Scenario | Step |
| --- | --- |
| S1–S9, S13, S18 | 1 (S13 UI in 4) |
| S10 | 1 (domain), 3 (UI) |
| S11, S15, S16 | 3 |
| S12, S17 | 2 |
| S14 | 5 |

## Out of scope for this handoff

- **Deployment** (step 6, done separately with the user): fixing Docker (`golang:1.21` vs `go 1.25` in `go.mod`), serving the client from the Go binary, hosting on Fly.io / Railway with HTTPS, the laptop fallback.
- Later items from spec §0: PINs for every role, protest workflow UI, schedule rules set by the admin, training mode, per-fight PDF protocol, Excel export, multiple rings.

## Open questions — answered (recorded in the spec)

1. ~~Junior age groups~~ — participants are 17+ only; knockdown limit 3 per round / 4 per fight for every category.
2. ~~Live scores for viewers~~ — yes, during the fight.
3. ~~Full-contact kick counter~~ — not needed: Low-kick is the only discipline.
4. ~~Rings~~ — one ring.
5. Late queued taps — Confirm is blocked until all judges are synced (warned override). Taps are judged by phone time (bounded). DQ/AB allowed after the final gong.
