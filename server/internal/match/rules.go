// Package match is the fight domain: events, the state they fold into, scoring,
// tie-breaks and clock rules. It is pure — no I/O, no goroutines, and time is
// always passed in by the caller (milliseconds since the Unix epoch).
package match

// Rule constants, named after TECHNICAL_SPECIFICATION.md.
const (
	// JudgeCount — exactly 3 side judges (§1).
	JudgeCount = 3

	// MinusPointValue — each minus point costs 3 points at every judge (§4).
	MinusPointValue = 3
	// KnockdownValue — each knockdown costs the downed fighter 1 point at every judge (§5).
	KnockdownValue = 1
	// WarningsForDQ — the 4th official warning disqualifies (§4).
	WarningsForDQ = 4

	// JudgeUndoWindowMs — a judge may undo during the round and up to 10 s after the gong (§3).
	JudgeUndoWindowMs = 10_000
	// GongGraceMs — an online tap counts if the server receives it ≤ 0.5 s after the gong (§3).
	GongGraceMs = 500

	// SecondsOutMs — "Seconds out" is signalled 10 s before the rest period ends (§2).
	SecondsOutMs = 10_000
	// MedicalTimeoutMs — the medical timeout is a separate 2-minute timer (§2).
	MedicalTimeoutMs = 120_000
)

// Default fight format (§2, seniors) and knockdown limits (§5), used when a
// category doesn't set its own.
const (
	DefaultRounds       = 3
	DefaultRoundSeconds = 120
	DefaultRestSeconds  = 60
	DefaultKDLimitRound = 3
	DefaultKDLimitFight = 4
)
