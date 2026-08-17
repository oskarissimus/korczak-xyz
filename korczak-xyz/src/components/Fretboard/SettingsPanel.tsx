/*
 * The neck deck's scope, as rows of a Win95 dialog.
 *
 * Rows and nothing around them: the panel these sit in belongs to the merged app
 * (`src/components/Flashcards/SettingsPanel.tsx`), which holds the sitting's own settings and the
 * headings that separate the two decks. **Scope only** — how long a sitting runs is a property of
 * the sitting, and a sitting mixes this deck with the chord one.
 *
 * Nothing here can produce an empty deck — the last string and the last direction cannot be
 * switched off, because a deck of nothing is a game that cannot start and an error message nobody
 * needs to read.
 */

import { STRING_COUNT, displayNotation, stringLabel } from '../../utils/fretboard/notes';
import type { Direction, Notation } from '../../utils/fretboard/notes';
import type { Settings } from '../../utils/fretboard/types';
import { Choice, Row } from '../Flashcards/controls';
import type { Translation } from './translations';

interface SettingsPanelProps {
  settings: Settings;
  onChange: (next: Settings) => void;
  t: Translation;
}

// Exported so the pre-hydration stand-in can lay out the same buttons rather than approximate them.
export const FRET_CHOICES = [3, 5, 7, 12];

/** What the fret-range buttons say. Shared with the stand-in for the same reason. */
export const fretChoiceLabel = (fret: number) => `0–${fret}`;

export default function FretboardSettingsRows({ settings, onChange, t }: SettingsPanelProps) {
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

  const toggleNotation = (notation: Notation) => {
    const has = settings.notations.includes(notation);
    if (has && settings.notations.length === 1) return;
    const notations = has
      ? settings.notations.filter((n) => n !== notation)
      : ([...settings.notations, notation] as Notation[]);
    onChange({ ...settings, notations });
  };

  return (
    <>
      <Row label={t.frets}>
        {FRET_CHOICES.map((fret) => (
          <Choice
            key={fret}
            active={settings.maxFret === fret}
            onClick={() => onChange({ ...settings, maxFret: fret })}
          >
            {fretChoiceLabel(fret)}
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
            {stringLabel(index, displayNotation(settings.notations))}
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
        {/* The two select-all directions sit after the ones they are built from, since each is
            the same question asked of the whole neck at once. They add few cards — twelve pitch
            classes and the pitches the scope can sound — but each of those cards is a long
            answer, so they are off by default like every other direction past the first two. */}
        <Choice
          active={settings.directions.includes('allNote')}
          onClick={() => toggleDirection('allNote')}
        >
          {t.dirAllNote}
        </Choice>
        <Choice
          active={settings.directions.includes('allPitch')}
          onClick={() => toggleDirection('allPitch')}
        >
          {t.dirAllPitch}
        </Choice>
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

      {/* Both can be on, like the directions row and unlike every other row here: `C♯` and `Cis`
          are two things to know, and the deck will drill them on separate schedules rather than
          make you pick a side. The buttons are the letters that differ, which is shorter than any
          word for it in either language and matches the single-letter string row above — one of
          which this setting renames. `Międzynarodowe` wraps the row onto a second line at 320px,
          and the pre-hydration stand-in reserves one line per row. */}
      <Row label={t.notation}>
        <Choice
          active={settings.notations.includes('international')}
          onClick={() => toggleNotation('international')}
          title={t.notationIntlTitle}
        >
          {t.notationIntl}
        </Choice>
        <Choice
          active={settings.notations.includes('german')}
          onClick={() => toggleNotation('german')}
          title={t.notationGermanTitle}
        >
          {t.notationGerman}
        </Choice>
      </Row>
    </>
  );
}
