import { useEffect, useState } from 'react';
import type { ClockView } from '../api/protocol';

export interface Countdown {
  /** Milliseconds left in the round, or in the rest period during REST. */
  remainingMs: number;
  isRest: boolean;
}

export function countdownAt(clock: ClockView, now: number): Countdown {
  switch (clock.phase) {
    case 'RUNNING':
      return { remainingMs: Math.max(0, clock.round_ms - clock.elapsed_ms - Math.max(0, now - clock.running_since)), isRest: false };
    case 'PAUSED':
      return { remainingMs: Math.max(0, clock.round_ms - clock.elapsed_ms), isRest: false };
    case 'REST':
      return { remainingMs: Math.min(clock.rest_ms, Math.max(0, clock.rest_ends_at - now)), isRest: true };
    case 'ENDED':
      return { remainingMs: 0, isRest: false };
    default:
      return { remainingMs: clock.round_ms, isRest: false };
  }
}

/** Re-renders every 100 ms while the clock or the rest period is running. */
export function useCountdown(clock: ClockView): Countdown {
  const [now, setNow] = useState(() => Date.now());
  const ticking = clock.phase === 'RUNNING' || clock.phase === 'REST';
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [ticking]);
  return countdownAt(clock, now);
}
