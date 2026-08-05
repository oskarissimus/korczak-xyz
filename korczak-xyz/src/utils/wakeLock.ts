/**
 * Keeps the screen awake while something on the page is worth looking at but not worth
 * touching — tuning a string, or reading lyrics that scroll themselves. Both are cases where
 * the phone's idle timer is measuring the wrong thing.
 *
 * The lock is released by the browser whenever the page is hidden and is not restored on the
 * way back, so wanting it and holding it are tracked separately and it is re-requested on
 * every return to visibility.
 *
 * Safari has had this since 16.4. Anywhere it is missing, every call is a no-op.
 */
export function createWakeLock() {
  let sentinel: WakeLockSentinel | null = null;
  let wanted = false;

  async function acquire() {
    if (!wanted || sentinel) return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      // Also fires when the system drops it on its own, not just on our release().
      sentinel.addEventListener('release', () => {
        sentinel = null;
      });
    } catch {
      // Denied, or the tab lost visibility mid-request. Not worth surfacing: the page works,
      // the screen just dims.
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') void acquire();
  }

  return {
    request() {
      if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
      if (wanted) return;
      wanted = true;
      document.addEventListener('visibilitychange', onVisibilityChange);
      void acquire();
    },

    release() {
      if (!wanted) return;
      wanted = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      const held = sentinel;
      sentinel = null;
      held?.release().catch(() => {});
    },
  };
}
