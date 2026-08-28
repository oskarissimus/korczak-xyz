/*
 * What the add form is about to add: a sleep or a routine, of a night or of a nap.
 *
 * Four buttons rather than two toggles, mirroring the live strip's four one-to-one — `Night sleep`,
 * `Nap`, `Night routine`, `Nap routine` — so what can be logged after the fact is exactly what can
 * be tapped as it happens. Before this the form slot's resting state was `EntryForm` alone, and a
 * routine that had already ended had nowhere to go: the live buttons stamp `Date.now()`, and the
 * history row is the long way round.
 *
 * It is a `ReactNode` handed to whichever form is mounted rather than a field either form owns,
 * because the two forms are deliberately separate — `EntryForm`'s validated `onSubmit` carries an
 * `EntryDraft` and has no use for a routine's. The same slot idiom the typing trainer's `StatsBar`
 * uses for its sync indicator: the form never learns what the row switches between.
 *
 * The labels are the live strip's own strings, so there is nothing new to translate.
 */

import type { SleepKind } from '../../utils/babySleep/types';
import type { Translation } from './translations';

export type AddWhat = 'sleep' | 'routine';

export interface AddChoiceValue {
  what: AddWhat;
  kind: SleepKind;
}

interface AddChoiceProps {
  value: AddChoiceValue;
  onChange: (value: AddChoiceValue) => void;
  t: Translation;
}

const OPTIONS: AddChoiceValue[] = [
  { what: 'sleep', kind: 'night' },
  { what: 'sleep', kind: 'nap' },
  { what: 'routine', kind: 'night' },
  { what: 'routine', kind: 'nap' },
];

function labelFor({ what, kind }: AddChoiceValue, t: Translation): string {
  if (what === 'sleep') return kind === 'night' ? t.startNight : t.startNap;
  return kind === 'night' ? t.routineStartNight : t.routineStartNap;
}

export default function AddChoice({ value, onChange, t }: AddChoiceProps) {
  return (
    <div className="bs-field">
      <span className="bs-field-label">{t.kind}</span>
      <div className="bs-toggle">
        {OPTIONS.map((option) => {
          const on = option.what === value.what && option.kind === value.kind;
          return (
            <button
              key={`${option.what}-${option.kind}`}
              type="button"
              className={`bs-toggle-btn${on ? ' bs-toggle-btn--on' : ''}`}
              aria-pressed={on}
              onClick={() => onChange(option)}
            >
              {labelFor(option, t)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
