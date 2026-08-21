/*
 * Ticks once a second while `active`, so a caller can read the clock during render.
 *
 * The elapsed time is recomputed as `now - start` on every render rather than accumulated in a
 * counter, and this one-second interval exists only to force those renders. That distinction matters
 * on a phone: a background tab has its timers throttled to once a minute or stopped altogether, so an
 * accumulator would drift and then jump. Recomputing from the entry's own start time means the
 * display is simply correct whenever it is painted, and the `visibilitychange` listener is there to
 * paint it the moment the tab comes back rather than up to a second later.
 *
 * The interval is mounted only while something is running — there is nothing to animate otherwise.
 *
 * Its own module because both `LiveControls` and `RoutineLive` need it, and two copies of a timing
 * rule with this much reasoning behind it is one copy too many.
 */

import { useEffect, useState } from 'react';

export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active]);

  return now;
}
