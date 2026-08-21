/*
 * Logging a bedtime routine after the fact, and correcting one.
 *
 * Deliberately not a fieldset inside `EntryForm`. A routine is its own record keyed by the night
 * (`routine.ts`), and a night broken by a waking is several entries — so a routine folded into the
 * entry form would ask the same question once per block, and `EntryForm`'s validated `onSubmit`
 * contract would have to carry a second draft it has no use for. It is its own record, so it gets
 * its own form, reachable from the routine line on any day in the history.
 *
 * Same field grammar as `EntryForm` and `SplitForm` — split `<input type="date">` and
 * `<input type="time">`, for the reason written down there — and the same division of labour: the
 * verdict comes from `validateRoutine`, which is pure and tested, and this component's only job is
 * to turn it into a sentence. The date is asked for on both instants because a routine that runs
 * past midnight is a real routine, and a time alone would then be ambiguous by a day.
 */

import { useEffect, useState } from 'react';

import { dayStart } from '../../utils/babySleep/days';
import {
  fromDateTimeInputs,
  toDateInputValue,
  toTimeInputValue,
} from '../../utils/babySleep/format';
import type { RoutineDraft, RoutineError, RoutineRecord } from '../../utils/babySleep/routine';
import { validateRoutine } from '../../utils/babySleep/routine';
import { fill, type Translation } from './translations';

interface RoutineFormProps {
  /** Local `yyyy-mm-dd` of the night being logged. */
  night: string;
  /** What the log already holds for that night, or undefined when adding one. */
  routine?: RoutineRecord;
  /** When that night's sleep began, for the defaults. Null when it has not yet. */
  asleepAt: number | null;
  dayLabel: string;
  onSubmit: (draft: RoutineDraft) => void;
  onRemove: () => void;
  onCancel: () => void;
  t: Translation;
}

interface Fields {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  open: boolean;
}

/** Where the fields sit before anything is typed: the routine as it usually runs, backwards from
 *  when he actually fell asleep, or a plain seven in the evening when that is not known yet. */
const DEFAULT_ROUTINE_MS = 45 * 60_000;
const DEFAULT_CRIB_MS = 20 * 60_000;
const DEFAULT_BEDTIME_MS = 19 * 60 * 60_000;

function fieldsFor(
  night: string,
  routine: RoutineRecord | undefined,
  asleepAt: number | null
): Fields {
  const anchor = asleepAt ?? dayStart(night) + DEFAULT_BEDTIME_MS;
  const start = routine?.start ?? anchor - DEFAULT_ROUTINE_MS;
  const end = routine?.end ?? anchor - DEFAULT_CRIB_MS;
  return {
    startDate: toDateInputValue(start),
    startTime: toTimeInputValue(start),
    endDate: toDateInputValue(end),
    endTime: toTimeInputValue(end),
    open: routine != null && routine.end == null,
  };
}

function messageFor(error: RoutineError, t: Translation): string {
  switch (error) {
    case 'no-start':
      return t.errRoutineNoStart;
    case 'end-before-start':
      return t.errRoutineOrder;
    case 'future':
      return t.errRoutineFuture;
    case 'too-long':
      return t.errRoutineTooLong;
  }
}

export default function RoutineForm({
  night,
  routine,
  asleepAt,
  dayLabel,
  onSubmit,
  onRemove,
  onCancel,
  t,
}: RoutineFormProps) {
  const [fields, setFields] = useState<Fields>(() => fieldsFor(night, routine, asleepAt));
  const [error, setError] = useState<RoutineError | null>(null);

  // Switching which night is being edited reloads the fields. The form is not remounted — it holds
  // its place on the page while the list below it changes, the way `EntryForm` does.
  useEffect(() => {
    setFields(fieldsFor(night, routine, asleepAt));
    setError(null);
  }, [night]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const start = fromDateTimeInputs(fields.startDate, fields.startTime);
    if (start == null) {
      setError('no-start');
      return;
    }
    const end = fields.open ? null : fromDateTimeInputs(fields.endDate, fields.endTime);
    if (!fields.open && end == null) {
      setError('end-before-start');
      return;
    }

    const draft: RoutineDraft = { start, end };
    const rejected = validateRoutine(draft, Date.now());
    if (rejected) {
      setError(rejected);
      return;
    }
    setError(null);
    onSubmit(draft);
  };

  return (
    <form className="bs-form" onSubmit={submit}>
      <h2 className="bs-subhead">{t.routineFormTitle}</h2>
      <p className="bs-split-of">{fill(t.routineFormOf, { day: dayLabel })}</p>

      <fieldset className="bs-field">
        <legend className="bs-field-label">{t.routineStartLabel}</legend>
        <div className="bs-when">
          <label>
            <span className="bs-sr">{t.dateLabel}</span>
            <input
              type="date"
              className="bs-date"
              value={fields.startDate}
              onChange={(e) => set('startDate', e.target.value)}
              required
            />
          </label>
          <label>
            <span className="bs-sr">{t.timeLabel}</span>
            <input
              type="time"
              className="bs-time"
              value={fields.startTime}
              onChange={(e) => set('startTime', e.target.value)}
              required
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="bs-field">
        <legend className="bs-field-label">{t.routineEndLabel}</legend>
        <label className="bs-check">
          <input
            type="checkbox"
            checked={fields.open}
            onChange={(e) => set('open', e.target.checked)}
          />
          <span>{t.routineOpen}</span>
        </label>
        {!fields.open && (
          <div className="bs-when">
            <label>
              <span className="bs-sr">{t.dateLabel}</span>
              <input
                type="date"
                className="bs-date"
                value={fields.endDate}
                onChange={(e) => set('endDate', e.target.value)}
                required
              />
            </label>
            <label>
              <span className="bs-sr">{t.timeLabel}</span>
              <input
                type="time"
                className="bs-time"
                value={fields.endTime}
                onChange={(e) => set('endTime', e.target.value)}
                required
              />
            </label>
          </div>
        )}
      </fieldset>

      {error && (
        <p className="bs-error" role="alert">
          {messageFor(error, t)}
        </p>
      )}

      <p className="bs-hint">{t.routineFormHint}</p>

      <div className="bs-form-actions">
        <button type="submit" className="bs-action">
          {t.save}
        </button>
        {routine && (
          <button type="button" className="bs-action" onClick={onRemove}>
            {t.routineRemove}
          </button>
        )}
        <button type="button" className="bs-action" onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
}
