import type { JudgeSeats } from '../api/socket';

/** What tapping a judge seat does: go straight there, or ask first. */
export type SeatChoice = 'go' | 'occupied' | 'unknown';

/**
 * Decides a tap on a seat from the server's fresh answer, else the last one
 * shown. With neither (no connection) it asks rather than guesses: a phone
 * that goes ahead would take the seat from its judge as soon as it reconnects.
 */
export function seatChoice(fresh: JudgeSeats | null, known: JudgeSeats | null, seat: number): SeatChoice {
  const seats = fresh ?? known;
  if (!seats) return 'unknown';
  return seats.occupied[seat - 1] ? 'occupied' : 'go';
}
