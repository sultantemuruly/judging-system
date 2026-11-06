import { useEffect } from 'react';

/** Keeps the screen on while active (§9). Needs HTTPS; elsewhere judges turn off auto-lock. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      navigator.wakeLock.request('screen')
        .then(l => { if (cancelled) l.release(); else lock = l; })
        .catch(() => { /* not allowed (no HTTPS, battery saver): nothing to do */ });
    };
    // The lock is dropped when the tab is hidden; take it again on return.
    const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release();
    };
  }, [active]);
}
