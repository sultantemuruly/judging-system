import type { JudgeSeats } from '../api/socket';

/** What tapping a judge seat does: go straight there, or ask first. */
export type SeatChoice = 'go' | 'occupied' | 'unknown';

/** A shown seat state older than this is not trusted without the server. */
export const KNOWN_MAX_AGE_MS = 6_000;

/** The last seat state the server gave, and when (ms since epoch). */
export interface KnownSeats {
  seats: JudgeSeats;
  at: number;
}

/**
 * Decides a tap on a seat from the server's fresh answer, else the last one
 * shown if it is recent. With neither (no connection) it asks rather than
 * guesses: a phone that goes ahead would take the seat from its judge as soon
 * as it reconnects.
 */
export function seatChoice(fresh: JudgeSeats | null, known: KnownSeats | null, now: number, seat: number): SeatChoice {
  const recent = known && now - known.at <= KNOWN_MAX_AGE_MS ? known.seats : null;
  const seats = fresh ?? recent;
  if (!seats) return 'unknown';
  return seats.occupied[seat - 1] ? 'occupied' : 'go';
}
