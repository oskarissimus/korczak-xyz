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
import { PITCH_CLASSES, STRING_COUNT, stringLabel } from '../../utils/fretboard/notes';
import type { Direction, NoteName } from '../../utils/fretboard/notes';
import { SCALE_TYPES, keyLabel } from '../../utils/fretboard/scales';
import type { ScaleType } from '../../utils/fretboard/scales';
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

/** Which label each scale type takes, so the row is one `SCALE_TYPES.map`. */
const SCALE_LABELS: Record<ScaleType, keyof Translation> = {
  major: 'scaleMajor',
  minor: 'scaleMinor',
  pentatonicMajor: 'scalePentMajor',
  pentatonicMinor: 'scalePentMinor',
  blues: 'scaleBlues',
};

/*
 * The row label names the group as well as printing it. Without that it is loose text next to a
 * run of buttons, and the Key row makes the cost obvious: its twelve roots and the six string
 * toggles carry the same four names between them, so `E` and `G` and `B` each announce themselves
 * twice on one panel with nothing to tell them apart.
 */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fb-setting">
      <span className="fb-setting-label">{label}</span>
      <div className="fb-setting-controls" role="group" aria-label={label}>
        {children}
      </div>
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

  // Picking a type with no key set has to choose a root, and C is the one to open on: it is the
  // key with no accidentals, so the first thing anyone sees is the scale and not a spelling.
  const setScaleType = (type: ScaleType) =>
    onChange({ ...settings, scale: { root: settings.scale?.root ?? 'C', type } });

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

      {/* Scope, like the fret range above it: which of the notes on those frets get asked. Off is
          all twelve, which is what the trainer has always done. */}
      <Row label={t.scale}>
        <Choice active={settings.scale == null} onClick={() => onChange({ ...settings, scale: null })}>
          {t.scaleOff}
        </Choice>
        {SCALE_TYPES.map((type) => (
          <Choice
            key={type}
            active={settings.scale?.type === type}
            onClick={() => setScaleType(type)}
          >
            {t[SCALE_LABELS[type]]}
          </Choice>
        ))}
      </Row>

      {/* Only once a scale is chosen — a row of twelve roots is the biggest control on the panel,
          and it says nothing at all when there is no key to be the root of. Each button is
          labelled under its own key's spelling, so it reads E♭ beside Major and D♯ beside Minor. */}
      {settings.scale && (
        <Row label={t.key}>
          {PITCH_CLASSES.map(({ name }) => {
            const choice = { root: name as NoteName, type: settings.scale!.type };
            return (
              <Choice
                key={name}
                active={settings.scale!.root === name}
                onClick={() => onChange({ ...settings, scale: choice })}
              >
                {keyLabel(choice, settings.notation)}
              </Choice>
            );
          })}
        </Row>
      )}

      <Row label={t.strings}>
        {Array.from({ length: STRING_COUNT }, (_, i) => STRING_COUNT - 1 - i).map((index) => (
          <Choice
            key={index}
            active={settings.strings.includes(index)}
            onClick={() => toggleString(index)}
          >
            {stringLabel(index, settings.notation)}
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
        <Choice
          active={settings.directions.includes('pitch')}
          onClick={() => toggleDirection('pitch')}
        >
          {t.dirPitch}
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

      {/* The two buttons are the letters that differ, which is shorter than any word for it in
          either language and matches the single-letter string row above — one of which this
          setting renames. `Międzynarodowe` wraps the row onto a second line at 320px, and the
          pre-hydration stand-in reserves one line per row. */}
      <Row label={t.notation}>
        <Choice
          active={settings.notation === 'international'}
          onClick={() => onChange({ ...settings, notation: 'international' })}
          title={t.notationIntlTitle}
        >
          {t.notationIntl}
        </Choice>
        <Choice
          active={settings.notation === 'german'}
          onClick={() => onChange({ ...settings, notation: 'german' })}
          title={t.notationGermanTitle}
        >
          {t.notationGerman}
        </Choice>
      </Row>
    </div>
  );
}
