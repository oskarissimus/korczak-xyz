/*
 * Scope and session shape, as a Win95 dialog.
 *
 * Every control is a row of pressed-or-raised buttons rather than a select or a slider: the
 * option sets are tiny and fixed, and a pressed button says which one is current without being
 * opened. Nothing here can produce an empty deck — the last string and the last direction
 * cannot be switched off, because a deck of nothing is a game that cannot start and an error
 * message nobody needs to read.
 */

import type { ReactNode } from 'react';
import { STRING_COUNT, STRING_LABELS } from '../../utils/fretboard/notes';
import type { Direction } from '../../utils/fretboard/notes';
import type { Settings } from '../../utils/fretboard/types';
import type { Translation } from './translations';

interface SettingsPanelProps {
  settings: Settings;
  onChange: (next: Settings) => void;
  t: Translation;
}

const FRET_CHOICES = [3, 5, 7, 12];
const LENGTH_CHOICES = [10, 20, 40];
const NEW_CHOICES = [3, 6, 10];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fb-setting">
      <span className="fb-setting-label">{label}</span>
      <div className="fb-setting-controls">{children}</div>
    </div>
  );
}

function Choice({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`fb-choice${active ? ' fb-choice--on' : ''}`}
      onClick={onClick}
      aria-pressed={active}
      title={title}
    >
      {children}
    </button>
  );
}

export default function SettingsPanel({ settings, onChange, t }: SettingsPanelProps) {
  const toggleString = (index: number) => {
    const has = settings.strings.includes(index);
    if (has && settings.strings.length === 1) return;
    const strings = has
      ? settings.strings.filter((s) => s !== index)
      : [...settings.strings, index].sort((a, b) => a - b);
    onChange({ ...settings, strings });
  };

  const toggleDirection = (direction: Direction) => {
    const has = settings.directions.includes(direction);
    if (has && settings.directions.length === 1) return;
    const directions = has
      ? settings.directions.filter((d) => d !== direction)
      : ([...settings.directions, direction] as Direction[]);
    onChange({ ...settings, directions });
  };

  return (
    <div className="fb-settings">
      <h3 className="fb-subhead">{t.settings}</h3>

      <Row label={t.frets}>
        {FRET_CHOICES.map((fret) => (
          <Choice
            key={fret}
            active={settings.maxFret === fret}
            onClick={() => onChange({ ...settings, maxFret: fret })}
          >
            0–{fret}
          </Choice>
        ))}
      </Row>

      <Row label={t.strings}>
        {Array.from({ length: STRING_COUNT }, (_, i) => STRING_COUNT - 1 - i).map((index) => (
          <Choice
            key={index}
            active={settings.strings.includes(index)}
            onClick={() => toggleString(index)}
          >
            {STRING_LABELS[index]}
          </Choice>
        ))}
      </Row>

      <Row label={t.directions}>
        <Choice
          active={settings.directions.includes('name')}
          onClick={() => toggleDirection('name')}
        >
          {t.dirName}
        </Choice>
        <Choice
          active={settings.directions.includes('find')}
          onClick={() => toggleDirection('find')}
        >
          {t.dirFind}
        </Choice>
      </Row>

      <Row label={t.sessionLength}>
        {LENGTH_CHOICES.map((length) => (
          <Choice
            key={length}
            active={settings.sessionLength === length}
            onClick={() => onChange({ ...settings, sessionLength: length })}
          >
            {length}
          </Choice>
        ))}
      </Row>

      <Row label={t.newPerSession}>
        {NEW_CHOICES.map((count) => (
          <Choice
            key={count}
            active={settings.newPerSession === count}
            onClick={() => onChange({ ...settings, newPerSession: count })}
          >
            {count}
          </Choice>
        ))}
      </Row>

      <Row label={t.stringLabels}>
        <Choice
          active={settings.stringLabels}
          onClick={() => onChange({ ...settings, stringLabels: true })}
        >
          {t.on}
        </Choice>
        <Choice
          active={!settings.stringLabels}
          onClick={() => onChange({ ...settings, stringLabels: false })}
        >
          {t.off}
        </Choice>
      </Row>
    </div>
  );
}
