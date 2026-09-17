/*
 * The small controls every stage of the settings sheet is built out of.
 *
 * They exist as one file because what makes this app look like Windows 95 is the *consistency*
 * of the chrome, not any one control: a property sheet is a grid of groove-bordered fieldsets
 * full of identical rows, and four screens each drawing their own label/input pair is how that
 * comes apart. `styles/sloper.css` holds the whole look; nothing here sets a style inline.
 */

import type { ReactNode } from 'react';
import { useId, useState } from 'react';

import type { Translation } from './translations';

interface FieldsetProps {
  legend: string;
  children: ReactNode;
  /** A sentence under the legend, for a group whose name cannot carry the whole point. */
  hint?: string;
}

export function Fieldset({ legend, hint, children }: FieldsetProps) {
  return (
    <fieldset className="slp-group">
      <legend className="slp-legend">{legend}</legend>
      {hint && <p className="slp-hint">{hint}</p>}
      {children}
    </fieldset>
  );
}

interface RowProps {
  label: string;
  children: (id: string) => ReactNode;
  hint?: string;
  /** Rendered under the control in red — a provider's own complaint, quoted as it came. */
  error?: string | null;
}

/** One labelled control. `children` is a function so the label's `for` always finds its input. */
export function Row({ label, hint, error, children }: RowProps) {
  const id = useId();
  return (
    <div className="slp-row">
      <label className="slp-label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <p className="slp-hint">{hint}</p>}
      {error && <p className="slp-error">{error}</p>}
    </div>
  );
}

interface SelectProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  id?: string;
}

export function Select<T extends string>({ value, options, onChange, disabled, id }: SelectProps<T>) {
  return (
    <select
      id={id}
      className="slp-select"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface NumberFieldProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  id?: string;
}

/**
 * A number input that does not fight the person typing into it.
 *
 * The naive version parses on every keystroke and coerces an empty box to the minimum, so
 * clearing "24" to type "30" jumps to 1 and leaves the caret after it. The draft is held as a
 * string and only committed as a number when it parses; an unparseable draft is snapped back to
 * the last good value on blur.
 */
export function NumberField({ value, min, max, onChange, id }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      id={id}
      className="slp-input slp-input-number"
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = Number.parseInt(e.target.value, 10);
        if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed)));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  lowLabel: string;
  highLabel: string;
  id?: string;
}

export function Slider({ value, min, max, step, onChange, lowLabel, highLabel, id }: SliderProps) {
  return (
    <>
      <input
        id={id}
        className="slp-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
      />
      <div className="slp-slider-ends">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </>
  );
}

interface KeyFieldProps {
  label: string;
  value: string | null;
  placeholder: string;
  onChange: (value: string | null) => void;
  t: Translation;
  hint?: string;
  error?: string | null;
}

/**
 * An API key.
 *
 * Masked by default with a Show/Hide toggle, because these are pasted in rooms with other people
 * in them and read back to check a paste landed whole. The chip beside the label says set or not
 * set without revealing anything — which is the question being asked nine times out of ten.
 *
 * Empty means null rather than `''`: a key that is not set and a key that is the empty string are
 * the same thing to every caller, and having one spelling of it is what lets `missingKeys` be a
 * one-liner.
 */
export function KeyField({ label, value, placeholder, onChange, t, hint, error }: KeyFieldProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <div className="slp-row">
      <label className="slp-label slp-label-inline" htmlFor={id}>
        <span>{label}</span>
        <span className={value ? 'slp-chip slp-chip-on' : 'slp-chip'}>
          {value ? t.keySet : t.keyNotSet}
        </span>
      </label>
      <div className="slp-key">
        <input
          id={id}
          className="slp-input"
          type={visible ? 'text' : 'password'}
          value={value ?? ''}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value.trim() || null)}
        />
        <button type="button" className="slp-key-toggle" onClick={() => setVisible(!visible)}>
          {visible ? t.keyHide : t.keyShow}
        </button>
      </div>
      {hint && <p className="slp-hint">{hint}</p>}
      {error && <p className="slp-error">{error}</p>}
    </div>
  );
}

interface CostLineProps {
  label: string;
  amount: number | null;
  variesLabel: string;
  detail?: string;
  note?: string;
}

/** One line of the estimate. Always says which side of "we do not know" it is on. */
export function CostLine({ label, amount, variesLabel, detail, note }: CostLineProps) {
  return (
    <div className="slp-cost">
      <div className="slp-cost-line">
        <span>{label}</span>
        <span className="slp-cost-amount">
          {amount !== null ? `~$${amount < 0.01 ? amount.toFixed(4) : amount.toFixed(2)}` : variesLabel}
        </span>
      </div>
      {detail && <p className="slp-hint">{detail}</p>}
      {note && <p className="slp-note">{note}</p>}
    </div>
  );
}

/** A spinning wait indicator drawn out of text, so it needs no image and no SVG filter. */
export function Spinner() {
  return <span className="slp-spinner" aria-hidden="true" />;
}
