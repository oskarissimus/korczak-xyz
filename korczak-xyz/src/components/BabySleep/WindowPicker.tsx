/*
 * Which stretch of days the stats describe.
 *
 * The presets are pressed-or-raised buttons, not a `<select>`: a select's popup belongs to the OS, so
 * on a phone it arrives as a dark rounded iOS sheet over a Windows 95 dialog. Four options fit on one
 * row at 320px anyway.
 *
 * The selected preset is marked by background *and* a leading glyph, never by `border-style: inset`
 * alone — `Layout.astro` gives every button `:active { border-style: inset }`, so a border-only
 * selection is indistinguishable from a press.
 */

import type { WindowChoice } from '../../utils/babySleep/types';
import type { Translation } from './translations';

interface WindowPickerProps {
  choice: WindowChoice;
  from: string;
  to: string;
  onChoice: (choice: WindowChoice) => void;
  onRange: (from: string, to: string) => void;
  t: Translation;
}

export default function WindowPicker({
  choice,
  from,
  to,
  onChoice,
  onRange,
  t,
}: WindowPickerProps) {
  const presets: { value: WindowChoice; label: string }[] = [
    { value: '3d', label: t.window3d },
    { value: '7d', label: t.window7d },
    { value: '30d', label: t.window30d },
    { value: 'custom', label: t.windowCustom },
  ];

  return (
    <div className="bs-window-picker">
      <span className="bs-field-label">{t.windowLabel}</span>
      <div className="bs-toggle" role="group" aria-label={t.windowLabel}>
        {presets.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={`bs-toggle-btn${choice === value ? ' bs-toggle-btn--on' : ''}`}
            aria-pressed={choice === value}
            onClick={() => onChoice(value)}
          >
            {choice === value && <span aria-hidden="true">{'✓ '}</span>}
            {label}
          </button>
        ))}
      </div>

      {choice === 'custom' && (
        <div className="bs-when">
          <label>
            <span className="bs-field-label">{t.customFrom}</span>
            <input
              type="date"
              className="bs-date"
              value={from}
              onChange={(e) => onRange(e.target.value, to)}
            />
          </label>
          <label>
            <span className="bs-field-label">{t.customTo}</span>
            <input
              type="date"
              className="bs-date"
              value={to}
              onChange={(e) => onRange(from, e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
