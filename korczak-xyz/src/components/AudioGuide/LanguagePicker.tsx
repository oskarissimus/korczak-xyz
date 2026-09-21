/*
 * What language the guide is narrated in — which is not what language the page is in.
 *
 * Two named options and a text box, because the value is a prompt fragment rather than a locale:
 * the model is told to write in whatever this says, so "Deutsch", "Español" and "Cymraeg" all
 * work and a fixed list would only be shorter than what it can do. The two named ones are the
 * site's own two languages, which is what most people will want and saves them the typing.
 *
 * The text box commits on blur and on Enter, not on every keystroke: half a typed language name
 * is a language, as far as a prompt is concerned, and a tap on a pin while "Ital" is in the box
 * would be narrated in it.
 */

import { useEffect, useId, useState } from 'react';

import { isPreset, normalizeLanguage, PRESET_LANGUAGES } from '../../utils/audioGuide/language';
import type { Translation } from './translations';

interface LanguagePickerProps {
  value: string;
  onChange: (value: string) => void;
  t: Translation;
}

const OTHER = '__other__';

export default function LanguagePicker({ value, onChange, t }: LanguagePickerProps) {
  const id = useId();
  const custom = !isPreset(value);
  const [draft, setDraft] = useState(custom ? value : '');
  const [showCustom, setShowCustom] = useState(custom);

  // A language restored from localStorage arrives after the first render.
  useEffect(() => {
    if (!isPreset(value)) {
      setDraft(value);
      setShowCustom(true);
    }
  }, [value]);

  const commit = () => {
    const next = normalizeLanguage(draft);
    // An empty box is not a choice to narrate in nothing; it leaves the last real value alone.
    if (next) onChange(next);
  };

  return (
    <div className="ag-language">
      <label className="ag-language-label" htmlFor={`${id}-select`}>
        {t.languageLabel}
      </label>
      <select
        id={`${id}-select`}
        className="ag-select"
        value={showCustom ? OTHER : value}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setShowCustom(true);
            return;
          }
          setShowCustom(false);
          onChange(e.target.value);
        }}
      >
        {PRESET_LANGUAGES.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        <option value={OTHER}>{t.languageOther}</option>
      </select>

      {showCustom && (
        <input
          type="text"
          className="ag-input"
          aria-label={t.languageCustomLabel}
          placeholder={t.languageCustomPlaceholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      )}
    </div>
  );
}
