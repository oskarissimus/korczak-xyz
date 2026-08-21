/*
 * The bedtime routine, live: the two taps that record it and the line that reads it back.
 *
 * Rendered above `LiveControls` and kept out of it, because a routine is not a sleep. It is its own
 * record keyed by the night (`routine.ts`), so it neither starts nor ends an entry — which is also
 * why the routine and the sleep are two independent taps rather than a wizard.
 *
 * Four states, all of them about the night `routineNightKey(now)` names:
 *
 *   none            [ Routine started ]
 *   running         Routine since 19:00 · 0:12:31        [ In crib ]   Clear
 *   in crib         Routine 19:00 – 19:25 · in crib since 19:25 · 0:08:02   Clear
 *   asleep          Routine 19:00 – 19:25 · fell asleep after 20m
 *
 * The line stays on the screen once the baby is asleep because that last reading is the one worth
 * looking at, and it is gone by breakfast: after 06:00 `routineNightKey` names the coming night,
 * which has no routine yet.
 */

import { formatHm, formatRunning } from '../../utils/babySleep/format';
import type { RoutineRecord } from '../../utils/babySleep/routine';
import { isStaleRoutine } from '../../utils/babySleep/routine';
import { fill, type Translation } from './translations';
import { useNow } from './useNow';

interface RoutineLiveProps {
  /** Tonight's routine, or null when none has been logged. */
  routine: RoutineRecord | null;
  /**
   * When the night this routine leads into began — its first block's start, or null while nobody has
   * fallen asleep yet. Not the running entry: a night broken by a waking is several entries, and the
   * settling is measured from the first of them.
   */
  asleepAt: number | null;
  formatTime: (t: number) => string;
  onStart: () => void;
  onInCrib: () => void;
  onClear: () => void;
  onFixStale: () => void;
  t: Translation;
}

export default function RoutineLive({
  routine,
  asleepAt,
  formatTime,
  onStart,
  onInCrib,
  onClear,
  onFixStale,
  t,
}: RoutineLiveProps) {
  // Tick only while something is actually counting up: a routine running, or a baby not yet asleep.
  const counting = routine != null && (routine.end == null || asleepAt == null);
  const now = useNow(counting);

  if (!routine) {
    return (
      <div className="bs-routine">
        <button type="button" className="bs-routine-btn" onClick={onStart}>
          {t.routineStart}
        </button>
      </div>
    );
  }

  const stale = isStaleRoutine(routine, now);

  if (routine.end == null) {
    return (
      <div className="bs-routine">
        <p className="bs-routine-line">
          <span>{fill(t.routineRunning, { time: formatTime(routine.start) })}</span>{' '}
          <span className="bs-routine-timer">{formatRunning(Math.max(0, now - routine.start))}</span>
        </p>
        <p className="bs-routine-actions">
          <button type="button" className="bs-routine-btn" onClick={onInCrib}>
            {t.routineInCrib}
          </button>
          <button type="button" className="bs-link" onClick={onClear}>
            {t.routineClear}
          </button>
        </p>
        {stale && (
          <div className="bs-warn" role="status">
            <p className="bs-warn-title">
              {fill(t.routineStaleTitle, { duration: formatRunning(now - routine.start) })}
            </p>
            <p>{t.routineStaleBody}</p>
            <p className="bs-warn-actions">
              <button type="button" className="bs-link" onClick={onFixStale}>
                {t.routineEdit}
              </button>
              <button type="button" className="bs-link" onClick={onClear}>
                {t.routineClear}
              </button>
            </p>
          </div>
        )}
      </div>
    );
  }

  const span = fill(t.routineSpan, {
    from: formatTime(routine.start),
    to: formatTime(routine.end),
  });

  return (
    <div className="bs-routine">
      <p className="bs-routine-line">
        <span>{span}</span>{' '}
        {asleepAt == null ? (
          <>
            <span>· {fill(t.routineWaiting, { time: formatTime(routine.end) })}</span>{' '}
            <span className="bs-routine-timer">
              {formatRunning(Math.max(0, now - routine.end))}
            </span>
          </>
        ) : (
          <span>
            ·{' '}
            {fill(t.routineAsleepAfter, {
              duration: formatHm(Math.max(0, asleepAt - routine.end)),
            })}
          </span>
        )}
      </p>
      {asleepAt == null && (
        <p className="bs-routine-actions">
          <button type="button" className="bs-link" onClick={onClear}>
            {t.routineClear}
          </button>
        </p>
      )}
    </div>
  );
}
