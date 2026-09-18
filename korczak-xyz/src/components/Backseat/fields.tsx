/*
 * The controls the setup sheet is built out of.
 *
 * Near-twins of sloper's `fields.tsx`, and deliberately a copy rather than an import. The two
 * files agree on shape and disagree on class prefix (`bks-` against `slp-`), and the prefix is the
 * whole point: `styles/backseat.css` is loaded on this app's two pages and `styles/sloper.css` on
 * that app's, so a shared component would pull one app's stylesheet into the other's bundle to
 * style four inputs. The site has made this trade before — every app keeps its own chrome — and
 * the cost of the duplication is a hundred lines that have not changed since they were written.
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
    <fieldset className="bks-group">
      <legend className="bks-legend">{legend}</legend>
      {hint && <p className="bks-hint">{hint}</p>}
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
    <div className="bks-row">
      <label className="bks-label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <p className="bks-hint">{hint}</p>}
      {error && <p className="bks-error">{error}</p>}
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

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  id,
}: SelectProps<T>) {
  return (
    <select
      id={id}
      className="bks-select"
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

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  lowLabel,
  highLabel,
  id,
}: SliderProps) {
  return (
    <>
      <input
        id={id}
        className="bks-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
      />
      <div className="bks-slider-ends">
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
    <div className="bks-row">
      <label className="bks-label bks-label-inline" htmlFor={id}>
        <span>{label}</span>
        <span className={value ? 'bks-chip bks-chip-on' : 'bks-chip'}>
          {value ? t.keySet : t.keyNotSet}
        </span>
      </label>
      <div className="bks-key">
        <input
          id={id}
          className="bks-input"
          type={visible ? 'text' : 'password'}
          value={value ?? ''}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value.trim() || null)}
        />
        <button type="button" className="bks-key-toggle" onClick={() => setVisible(!visible)}>
          {visible ? t.keyHide : t.keyShow}
        </button>
      </div>
      {hint && <p className="bks-hint">{hint}</p>}
      {error && <p className="bks-error">{error}</p>}
    </div>
  );
}
