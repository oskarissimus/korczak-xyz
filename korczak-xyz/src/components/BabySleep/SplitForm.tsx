/*
 * Adding a wake period to a sleep already logged.
 *
 * Deliberately not a mode of `EntryForm`. That form asks for one interval and this one asks for the
 * hole in the middle of one, and the two share no field: folding them together would mean a `kind`
 * toggle and a "still asleep" checkbox that make no sense here, guarded by a flag.
 *
 * Same field grammar as `EntryForm` though — split `<input type="date">` and `<input type="time">`,
 * for the reason written down there — and the same division of labour: the verdict comes from
 * `splitEntry`, which is pure and tested, and this component's only job is to turn it into a
 * sentence. A date *is* asked for on both instants, and it is not redundant on a form whose common
 * case is a night: the waking is on the far side of midnight from the bedtime, so a time alone would
 * be ambiguous by exactly the twelve hours that matter.
 *
 * The sleep being split is named at the top because this form sits above the history, and by the
 * time the times are typed the row it came from may be off the screen.
 */

import { useEffect, useState } from 'react';

import {
  fromDateTimeInputs,
  toDateInputValue,
  toTimeInputValue,
} from '../../utils/babySleep/format';
import type { SplitError } from '../../utils/babySleep/split';
import { defaultSplit, splitEntry } from '../../utils/babySleep/split';
import type { SleepEntry } from '../../utils/babySleep/types';
import { fill, type Translation } from './translations';

interface SplitFormProps {
  entry: SleepEntry;
  formatTime: (t: number) => string;
  onSplit: (wakeAt: number, sleepAt: number) => void;
  onCancel: () => void;
  t: Translation;
}

interface Fields {
  wakeDate: string;
  wakeTime: string;
  sleepDate: string;
  sleepTime: string;
}

function fieldsFor(entry: SleepEntry, now: number): Fields {
  const { wakeAt, sleepAt } = defaultSplit(entry, now);
  return {
    wakeDate: toDateInputValue(wakeAt),
    wakeTime: toTimeInputValue(wakeAt),
    sleepDate: toDateInputValue(sleepAt),
    sleepTime: toTimeInputValue(sleepAt),
  };
}

function messageFor(error: SplitError, t: Translation): string {
  switch (error) {
    case 'wake-outside':
      return t.errWakeOutside;
    case 'wake-order':
      return t.errWakeOrder;
    case 'too-short':
      return t.errSplitTooShort;
    case 'future':
      return t.errFuture;
    case 'not-splittable':
      // Only reachable if the entry was deleted on another device while this form was open.
      return t.errWakeOutside;
  }
}

export default function SplitForm({ entry, formatTime, onSplit, onCancel, t }: SplitFormProps) {
  const [fields, setFields] = useState<Fields>(() => fieldsFor(entry, Date.now()));
  const [error, setError] = useState<SplitError | null>(null);

  // Switching which sleep is being split reloads the fields. The form is not remounted — it holds
  // its place on the page while the list below it changes, the way `EntryForm` does.
  useEffect(() => {
    setFields(fieldsFor(entry, Date.now()));
    setError(null);
  }, [entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const wakeAt = fromDateTimeInputs(fields.wakeDate, fields.wakeTime);
    const sleepAt = fromDateTimeInputs(fields.sleepDate, fields.sleepTime);
    if (wakeAt == null || sleepAt == null) {
      setError('wake-outside');
      return;
    }
    const outcome = splitEntry(entry, wakeAt, sleepAt, Date.now());
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setError(null);
    onSplit(wakeAt, sleepAt);
  };

  return (
    <form className="bs-form" onSubmit={submit}>
      <h2 className="bs-subhead">{t.splitTitle}</h2>
      <p className="bs-split-of">
        {fill(t.splitOf, {
          kind: entry.kind === 'night' ? t.kindNight : t.kindNap,
          from: formatTime(entry.start),
          to: entry.end == null ? t.running : formatTime(entry.end),
        })}
      </p>

      <fieldset className="bs-field">
        <legend className="bs-field-label">{t.wokeUpLabel}</legend>
        <div className="bs-when">
          <label>
            <span className="bs-sr">{t.dateLabel}</span>
            <input
              type="date"
              className="bs-date"
              value={fields.wakeDate}
              onChange={(e) => set('wakeDate', e.target.value)}
              required
            />
          </label>
          <label>
            <span className="bs-sr">{t.timeLabel}</span>
            <input
              type="time"
              className="bs-time"
              value={fields.wakeTime}
              onChange={(e) => set('wakeTime', e.target.value)}
              required
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="bs-field">
        <legend className="bs-field-label">{t.backAsleep}</legend>
        <div className="bs-when">
          <label>
            <span className="bs-sr">{t.dateLabel}</span>
            <input
              type="date"
              className="bs-date"
              value={fields.sleepDate}
              onChange={(e) => set('sleepDate', e.target.value)}
              required
            />
          </label>
          <label>
            <span className="bs-sr">{t.timeLabel}</span>
            <input
              type="time"
              className="bs-time"
              value={fields.sleepTime}
              onChange={(e) => set('sleepTime', e.target.value)}
              required
            />
          </label>
        </div>
      </fieldset>

      {error && (
        <p className="bs-error" role="alert">
          {messageFor(error, t)}
        </p>
      )}

      <p className="bs-hint">{t.splitHint}</p>

      <div className="bs-form-actions">
        <button type="submit" className="bs-action">
          {t.splitButton}
        </button>
        <button type="button" className="bs-action" onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
}
