import { useEffect, useState } from 'react';
import type { ClockView } from '../api/protocol';
import { serverNow } from '../api/serverClock';

/** "Seconds out" is signalled 10 s before the rest period ends (§2). */
export const SECONDS_OUT_MS = 10_000;

export interface Countdown {
  /** Milliseconds left in the round, or in the rest period during REST. */
  remainingMs: number;
  isRest: boolean;
  secondsOut: boolean;
}

export function countdownAt(clock: ClockView, now: number): Countdown {
  switch (clock.phase) {
    case 'RUNNING':
      return { remainingMs: Math.max(0, clock.round_ms - clock.elapsed_ms - Math.max(0, now - clock.running_since)), isRest: false, secondsOut: false };
    case 'PAUSED':
      return { remainingMs: Math.max(0, clock.round_ms - clock.elapsed_ms), isRest: false, secondsOut: false };
    case 'REST': {
      const remainingMs = Math.min(clock.rest_ms, Math.max(0, clock.rest_ends_at - now));
      return { remainingMs, isRest: true, secondsOut: remainingMs <= SECONDS_OUT_MS };
    }
    case 'ENDED':
      return { remainingMs: 0, isRest: false, secondsOut: false };
    default:
      return { remainingMs: clock.round_ms, isRest: false, secondsOut: false };
  }
}

/** Counts down from server time; re-renders every 100 ms while the clock or the rest runs. */
export function useCountdown(clock: ClockView): Countdown {
  const [now, setNow] = useState(serverNow);
  const ticking = clock.phase === 'RUNNING' || clock.phase === 'REST';
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(id);
  }, [ticking]);
  return countdownAt(clock, now);
}

/** Milliseconds until a server-time deadline (0 if none, at most maxMs), re-rendering every 250 ms. */
export function useRemaining(endsAt: number, maxMs: number): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!endsAt) return;
    const id = window.setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(id);
  }, [endsAt]);
  return endsAt ? Math.min(maxMs, Math.max(0, endsAt - now)) : 0;
}
