import { describe, expect, it } from 'vitest';
import { seatChoice } from './seatChoice';

const seats = (occupied: boolean[]) => ({ protected: [false, false, false], occupied });

describe('seatChoice', () => {
  it('goes straight to a free seat and asks before taking an occupied one', () => {
    expect(seatChoice(seats([false, true, false]), null, 1)).toBe('go');
    expect(seatChoice(seats([false, true, false]), null, 2)).toBe('occupied');
  });

  it('trusts the fresh answer over the shown one', () => {
    expect(seatChoice(seats([false, false, false]), seats([false, true, false]), 2)).toBe('go');
  });

  it('falls back to the last shown state when the server does not answer', () => {
    expect(seatChoice(null, seats([true, false, false]), 1)).toBe('occupied');
    expect(seatChoice(null, seats([true, false, false]), 2)).toBe('go');
  });

  it('asks when nothing is known, rather than taking a seat blindly', () => {
    expect(seatChoice(null, null, 3)).toBe('unknown');
  });
});
