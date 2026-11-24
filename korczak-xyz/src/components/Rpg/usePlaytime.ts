/*
 * Counts the seconds the game is played on this page and hands them to the gateway
 * (`utils/rpg/playtime.ts` has the why). A second counts when the tab is visible and there was an
 * input — a key, a touch, the pointer moving — within `IDLE_MS`: listening to a long line counts, a
 * tab left open overnight does not. Reported every `BEAT_MS` and once more as the tab is hidden.
 * Signed in only; nothing is kept in the browser, so a report that fails is simply lost.
 */

import { useEffect } from 'react';

import { BEAT_MS, IDLE_MS, MAX_BEAT_S } from '../../utils/rpg/playtime';
import { reportPlaytime } from '../../utils/rpg/gateway';

export function usePlaytime(uid: string | null): void {
  useEffect(() => {
    if (!uid || typeof document === 'undefined') return;
    let lastInput = Date.now();
    let pending = 0;
    let tick = Date.now();

    const touch = () => {
      lastInput = Date.now();
    };
    // The pointer moving fires a lot; the time of the last one is all that is kept.
    const events = ['keydown', 'pointerdown', 'pointermove', 'touchstart', 'wheel'] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });

    const count = () => {
      const now = Date.now();
      const dt = Math.min(now - tick, 5_000);
      tick = now;
      if (document.visibilityState === 'visible' && now - lastInput < IDLE_MS) pending += dt / 1000;
    };
    const flush = () => {
      count();
      const s = Math.min(MAX_BEAT_S, Math.floor(pending));
      if (s < 1) return;
      pending -= s;
      void reportPlaytime(s);
    };

    const counter = window.setInterval(count, 1_000);
    const beat = window.setInterval(flush, BEAT_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
      else {
        tick = Date.now();
        touch();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);

    return () => {
      flush();
      window.clearInterval(counter);
      window.clearInterval(beat);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      for (const e of events) window.removeEventListener(e, touch, { capture: true });
    };
  }, [uid]);
}
