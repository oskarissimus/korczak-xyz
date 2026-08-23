/*
 * The routine, live: the two taps that record it and the line that reads it back.
 *
 * Rendered above `LiveControls` and kept out of it, because a routine is not a sleep. It is its own
 * record (`routine.ts`), so it neither starts nor ends an entry — which is also why the routine and
 * the sleep are two independent taps rather than a wizard.
 *
 * **Two slots, one per kind.** A nap is led into the same way a night is, so each kind shows either
 * its live routine or the button that starts one:
 *
 *   nothing yet     [ Night routine ]  [ Nap routine ]
 *   running         Routine since 19:00 · 0:12:31        [ In crib ]   Clear
 *   in crib         Routine 19:00 – 19:25 · in crib since 19:25 · 0:08:02   Clear
 *   asleep          Routine 19:00 – 19:25 · fell asleep after 20m        [ Nap routine ]
 *
 * The kind is explicit at the tap rather than inferred from the clock, because a late-afternoon nap
 * and an early bedtime are the same hour and the record's id is fixed by that first write.
 *
 * Each line stays on the screen once the baby is asleep because that last reading is the one worth
 * looking at, and each is gone by its own clock: the night's after 06:00, when `routineNightKey`
 * names the coming night; the nap's at midnight, when the day it is keyed to ends.
 *
 * A finished *nap* line keeps the button beneath it, because the day holds one routine per nap and
 * the afternoon's has to be startable while the morning's reading is still on the screen. A finished
 * night line does not: a night's id is its night key, so a second tap would overwrite the evening
 * just recorded rather than begin anything.
 *
 * `useNow` is read once here and passed down rather than called per line: two lines counting up is
 * still one second's tick, and two intervals for one clock is one too many.
 */

import { formatHm, formatRunning } from '../../utils/babySleep/format';
import type { RoutineRecord } from '../../utils/babySleep/routine';
import { isStaleRoutine } from '../../utils/babySleep/routine';
import type { SleepKind } from '../../utils/babySleep/types';
import { fill, type Translation } from './translations';
import { useNow } from './useNow';

/** One kind's state: the routine it has, if any, and when the sleep it led into began. */
export interface RoutineSlot {
  kind: SleepKind;
  routine: RoutineRecord | null;
  /**
   * When the sleep this routine leads into began, or null while nobody has fallen asleep yet. For a
   * night that is its *first* block's start — a night broken by a waking is several entries, and the
   * settling is measured from the first of them.
   */
  asleepAt: number | null;
  /**
   * Whether a *further* routine of this kind can be started once this one is finished.
   *
   * True for naps, where the day holds one per nap: the finished line is worth keeping — it is the
   * last reading — but without the button beside it there is no way to begin the afternoon's until
   * midnight. False for the night, which has at most one by construction: its id *is* its night key,
   * so a second tap would not start anything, it would overwrite the evening just recorded.
   */
  canRestart: boolean;
}

interface RoutineLiveProps {
  slots: RoutineSlot[];
  formatTime: (t: number) => string;
  onStart: (kind: SleepKind) => void;
  onInCrib: (routine: RoutineRecord) => void;
  onClear: (routine: RoutineRecord) => void;
  onFixStale: (routine: RoutineRecord) => void;
  t: Translation;
}

/** Whether this slot has anything counting up — a routine running, or a baby not yet asleep. */
function counting(slot: RoutineSlot): boolean {
  return slot.routine != null && (slot.routine.end == null || slot.asleepAt == null);
}

function startLabel(kind: SleepKind, t: Translation): string {
  return kind === 'night' ? t.routineStartNight : t.routineStartNap;
}

interface RoutineLineProps extends RoutineLiveProps {
  slot: RoutineSlot;
  now: number;
}

function RoutineLine({
  slot,
  now,
  formatTime,
  onStart,
  onInCrib,
  onClear,
  onFixStale,
  t,
}: RoutineLineProps) {
  const { kind, routine, asleepAt, canRestart } = slot;

  /* An idle slot is only its button, and its wrapper says so: the stylesheet lets those two shrink
     to their own width and sit side by side, while a slot with a line takes the row. */
  if (!routine) {
    return (
      <div className="bs-routine-slot bs-routine-slot--idle">
        <button type="button" className="bs-routine-btn" onClick={() => onStart(kind)}>
          {startLabel(kind, t)}
        </button>
      </div>
    );
  }

  const stale = isStaleRoutine(routine, now);

  if (routine.end == null) {
    return (
      <div className="bs-routine-slot">
        <p className="bs-routine-line">
          <span>
            {fill(kind === 'night' ? t.routineRunning : t.routineNapRunning, {
              time: formatTime(routine.start),
            })}
          </span>{' '}
          <span className="bs-routine-timer">{formatRunning(Math.max(0, now - routine.start))}</span>
        </p>
        <p className="bs-routine-actions">
          <button type="button" className="bs-routine-btn" onClick={() => onInCrib(routine)}>
            {t.routineInCrib}
          </button>
          <button type="button" className="bs-link" onClick={() => onClear(routine)}>
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
              <button type="button" className="bs-link" onClick={() => onFixStale(routine)}>
                {t.routineEdit}
              </button>
              <button type="button" className="bs-link" onClick={() => onClear(routine)}>
                {t.routineClear}
              </button>
            </p>
          </div>
        )}
      </div>
    );
  }

  const span = fill(kind === 'night' ? t.routineSpan : t.routineNapSpan, {
    from: formatTime(routine.start),
    to: formatTime(routine.end),
  });

  return (
    <div className="bs-routine-slot">
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
      {asleepAt == null ? (
        <p className="bs-routine-actions">
          <button type="button" className="bs-link" onClick={() => onClear(routine)}>
            {t.routineClear}
          </button>
        </p>
      ) : (
        canRestart && (
          <p className="bs-routine-actions">
            <button type="button" className="bs-routine-btn" onClick={() => onStart(kind)}>
              {startLabel(kind, t)}
            </button>
          </p>
        )
      )}
    </div>
  );
}

export default function RoutineLive(props: RoutineLiveProps) {
  const now = useNow(props.slots.some(counting));

  return (
    <div className="bs-routine">
      {props.slots.map((slot) => (
        <RoutineLine key={slot.kind} {...props} slot={slot} now={now} />
      ))}
    </div>
  );
}
