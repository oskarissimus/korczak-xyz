/*
 * Adding a sleep after the fact, and correcting one.
 *
 * Split `<input type="date">` and `<input type="time">` rather than one `datetime-local`: every input
 * on this site inherits an 8px padding and a 2px inset border from `Layout.astro`, and iOS lays the
 * native segmented `datetime-local` picker out inside that box, clipping the last segment. Two fields
 * also let the date be left alone while only the time is corrected, which is the common edit.
 *
 * Validation is `validateDraft`, which is pure and tested. This component's only job is to turn its
 * verdict into a sentence — including the one case where the message depends on the kind, since
 * "longer than five hours" is a plausible night and an implausible nap.
 */

import { useEffect, useState, type ReactNode } from 'react';

import {
  fromDateTimeInputs,
  toDateInputValue,
  toTimeInputValue,
} from '../../utils/babySleep/format';
import type { DraftError, EntryDraft, SleepEntry, SleepKind } from '../../utils/babySleep/types';
import { validateDraft } from '../../utils/babySleep/types';
import type { Translation } from './translations';

interface EntryFormProps {
  /** The entry being corrected, or undefined when adding a new one. */
  editing?: SleepEntry;
  /**
   * The `AddChoice` row, drawn while adding. When it is present **it** is the type picker — this
   * form draws no kind row of its own and takes `kind` from the prop below, because two controls
   * setting one field is two answers to the same question.
   */
  header?: ReactNode;
  /** The kind the header has selected. Ignored while editing, where the kind is the entry's own. */
  kind?: SleepKind;
  /** Live entries the draft must not collide with. The one being edited is excluded by id. */
  others: SleepEntry[];
  onSubmit: (draft: EntryDraft) => void;
  onCancel?: () => void;
  t: Translation;
}

interface Fields {
  kind: SleepKind;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  open: boolean;
}

function fieldsFor(entry: SleepEntry | undefined, now: number, kind: SleepKind): Fields {
  const start = entry?.start ?? now;
  const end = entry?.end ?? now;
  return {
    kind: entry?.kind ?? kind,
    startDate: toDateInputValue(start),
    startTime: toTimeInputValue(start),
    endDate: toDateInputValue(end),
    endTime: toTimeInputValue(end),
    open: entry != null && entry.end == null,
  };
}

function messageFor(error: DraftError, kind: SleepKind, t: Translation): string {
  switch (error) {
    case 'no-start':
      return t.errNoStart;
    case 'end-before-start':
      return t.errEndBeforeStart;
    case 'too-short':
      return t.errTooShort;
    case 'too-long':
      return kind === 'night' ? t.errTooLongNight : t.errTooLongNap;
    case 'future':
      return t.errFuture;
    case 'overlap':
      return t.errOverlap;
  }
}

export default function EntryForm({
  editing,
  header,
  kind = 'nap',
  others,
  onSubmit,
  onCancel,
  t,
}: EntryFormProps) {
  const [fields, setFields] = useState<Fields>(() => fieldsFor(editing, Date.now(), kind));
  const [error, setError] = useState<DraftError | null>(null);

  // Switching which entry is being edited has to reload the fields; the form is not remounted,
  // because it keeps its place on the page while the list above it changes.
  useEffect(() => {
    setFields(fieldsFor(editing, Date.now(), kind));
    setError(null);
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The header owns the kind while adding. Only the kind moves: re-seeding the whole form would
  // throw away times already typed, and flipping Night/Nap is not a decision to start over from.
  useEffect(() => {
    setFields((f) => (f.kind === kind ? f : { ...f, kind }));
  }, [kind]);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const now = Date.now();
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

    const draft: EntryDraft = { kind: fields.kind, start, end };
    const rejected = validateDraft(
      draft,
      others.filter((e) => e.id !== editing?.id),
      now
    );
    if (rejected) {
      setError(rejected);
      return;
    }
    setError(null);
    onSubmit(draft);
    if (!editing) setFields(fieldsFor(undefined, Date.now(), fields.kind));
  };

  return (
    <form className="bs-form" onSubmit={submit}>
      <h2 className="bs-subhead">{editing ? t.editTitle : t.addTitle}</h2>

      {header}

      {!header && (
        <div className="bs-field">
          <span className="bs-field-label">{t.kind}</span>
          <div className="bs-toggle">
            {(['night', 'nap'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`bs-toggle-btn${fields.kind === option ? ' bs-toggle-btn--on' : ''}`}
                aria-pressed={fields.kind === option}
                onClick={() => set('kind', option)}
              >
                {option === 'night' ? t.kindNight : t.kindNap}
              </button>
            ))}
          </div>
        </div>
      )}

      <fieldset className="bs-field">
        <legend className="bs-field-label">{t.fellAsleep}</legend>
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
        <legend className="bs-field-label">{t.wokeUpLabel}</legend>
        <label className="bs-check">
          <input
            type="checkbox"
            checked={fields.open}
            onChange={(e) => set('open', e.target.checked)}
          />
          <span>{t.stillAsleep}</span>
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
          {messageFor(error, fields.kind, t)}
        </p>
      )}

      <div className="bs-form-actions">
        <button type="submit" className="bs-action">
          {editing ? t.save : t.add}
        </button>
        {onCancel && (
          <button type="button" className="bs-action" onClick={onCancel}>
            {t.cancel}
          </button>
        )}
      </div>
    </form>
  );
}
