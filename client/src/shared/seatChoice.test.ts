import { describe, expect, it } from 'vitest';
import { KNOWN_MAX_AGE_MS, seatChoice } from './seatChoice';

const seats = (occupied: boolean[]) => ({ occupied });
const now = 1_000_000;
const shown = (occupied: boolean[], ageMs = 0) => ({ seats: seats(occupied), at: now - ageMs });

describe('seatChoice', () => {
  it('goes straight to a free seat and asks before taking an occupied one', () => {
    expect(seatChoice(seats([false, true, false]), null, 1, now)).toBe('go');
    expect(seatChoice(seats([false, true, false]), null, 2, now)).toBe('occupied');
  });

  it('trusts the fresh answer over the shown one', () => {
    expect(seatChoice(seats([false, false, false]), shown([false, true, false]), 2, now)).toBe('go');
  });

  it('falls back to a recent shown state when the server does not answer', () => {
    expect(seatChoice(null, shown([true, false, false], 3_000), 1, now)).toBe('occupied');
    expect(seatChoice(null, shown([true, false, false], 3_000), 2, now)).toBe('go');
  });

  it('does not trust an old shown state: the seat may have been taken since', () => {
    expect(seatChoice(null, shown([false, false, false], KNOWN_MAX_AGE_MS + 1), 1, now)).toBe('unknown');
  });

  it('asks when nothing is known, rather than taking a seat blindly', () => {
    expect(seatChoice(null, null, 3, now)).toBe('unknown');
  });
});
