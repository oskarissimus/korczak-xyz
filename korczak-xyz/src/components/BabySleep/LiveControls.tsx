/*
 * The one-handed, three-in-the-morning part of the page: two buttons to start a sleep, one to end it.
 *
 * The bedtime routine that leads into a night is `RoutineLive`, rendered above this — nothing here
 * knows about it. A routine is its own record keyed by night, so it neither starts nor ends a sleep.
 */

import { formatRunning } from '../../utils/babySleep/format';
import type { SleepEntry, SleepKind } from '../../utils/babySleep/types';
import { isStale } from '../../utils/babySleep/types';
import { fill, type Translation } from './translations';
import { useNow } from './useNow';

interface LiveControlsProps {
  open: SleepEntry | null;
  formatTime: (t: number) => string;
  onStart: (kind: SleepKind) => void;
  onEnd: () => void;
  onFixStale: (entry: SleepEntry) => void;
  onDiscard: (entry: SleepEntry) => void;
  t: Translation;
}

export default function LiveControls({
  open,
  formatTime,
  onStart,
  onEnd,
  onFixStale,
  onDiscard,
  t,
}: LiveControlsProps) {
  const now = useNow(open != null);

  if (!open) {
    return (
      <div className="bs-live">
        <p className="bs-live-state">{t.awake}</p>
        <div className="bs-live-buttons">
          <button type="button" className="bs-big bs-big--night" onClick={() => onStart('night')}>
            {t.startNight}
          </button>
          <button type="button" className="bs-big bs-big--nap" onClick={() => onStart('nap')}>
            {t.startNap}
          </button>
        </div>
        <p className="bs-hint">{t.liveHint}</p>
      </div>
    );
  }

  const elapsed = Math.max(0, now - open.start);
  const stale = isStale(open, now);

  return (
    <div className="bs-live">
      <p className="bs-live-state">
        {open.kind === 'night' ? t.asleepNight : t.asleepNap}{' '}
        <span className="bs-live-since">{fill(t.since, { time: formatTime(open.start) })}</span>
      </p>
      <p className="bs-live-timer" aria-live="off">
        {formatRunning(elapsed)}
      </p>
      <div className="bs-live-buttons">
        {/* Wrapped, not passed bare: `onEnd` takes an optional wake time, and React would hand a
            click event to it. */}
        <button type="button" className="bs-big bs-big--wake" onClick={() => onEnd()}>
          {t.wokeUp}
        </button>
      </div>
      {stale && (
        <div className="bs-warn" role="status">
          <p className="bs-warn-title">
            {fill(t.staleTitle, { duration: formatRunning(elapsed) })}
          </p>
          <p>{t.staleBody}</p>
          <p className="bs-warn-actions">
            <button type="button" className="bs-link" onClick={() => onFixStale(open)}>
              {t.staleFix}
            </button>
            <button type="button" className="bs-link" onClick={() => onDiscard(open)}>
              {t.staleDiscard}
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
