/*
 * The chord deck's scope, as rows of a Win95 dialog.
 *
 * Rows and nothing around them: the panel these sit in belongs to the merged app
 * (`src/components/Flashcards/SettingsPanel.tsx`), which holds the sitting's own settings and the
 * headings that separate the two decks. **Scope only** — how long a sitting runs is a property of
 * the sitting, and a sitting mixes this deck with the neck one.
 *
 * Nothing here can produce an empty deck — the last direction, the last pattern and the last
 * notation cannot be switched off, because a deck of nothing is a game that cannot start and an
 * error message nobody needs to read.
 */

import { DIRECTIONS } from '../../utils/transpose/cards';
import type { Direction } from '../../utils/transpose/cards';
import { effectiveTonics } from '../../utils/transpose/deck';
import type { LibraryIndex } from '../../utils/transpose/library';
import { NOTATIONS, PATTERN_IDS, patternLabel, pitchClassLabel } from '../../utils/transpose/theory';
import type { Notation, PatternId, PitchClass } from '../../utils/transpose/theory';
import type { KeyScope, Settings } from '../../utils/transpose/types';
import { Choice, Row } from '../Flashcards/controls';
import type { Translation } from './translations';

interface SettingsPanelProps {
  settings: Settings;
  onChange: (next: Settings) => void;
  library: LibraryIndex;
  t: Translation;
}

const TONICS: PitchClass[] = Array.from({ length: 12 }, (_, i) => i);

/**
 * What each notation button says: a sample of the thing itself.
 *
 * `C#·a·H` rather than the word "Polish", because the difference between these systems *is* how
 * they write those three, and a label naming a country makes you remember which is which instead
 * of reading it. The tooltip spells it out.
 */
const NOTATION_SAMPLES: Record<Notation, string> = {
  polish: 'C#·a·H',
  german: 'Cis·a·H',
  international: 'C#·Am·B',
};

const NOTATION_TITLES: Record<Notation, keyof Translation> = {
  polish: 'notationPolish',
  german: 'notationGerman',
  international: 'notationInternational',
};

const DIRECTION_LABELS: Record<Direction, keyof Translation> = {
  transpose: 'dirTranspose',
  degrees: 'dirDegrees',
  key: 'dirKey',
};

export default function TransposeSettingsRows({ settings, onChange, library, t }: SettingsPanelProps) {
  /*
   * What the key row is currently showing as chosen, and what the labels on it say.
   *
   * The notation is the first the player has selected rather than the card's, because this row is
   * not a card — it is the same picture the `ChordPad` draws, and `pitchClassLabel` offers both
   * spellings where they differ for the reason it does there: a pitch class has no key to spell it.
   */
  const resolved = effectiveTonics(settings, library);
  const padNotation: Notation = settings.notations[0] ?? 'polish';

  /** Toggle one value of a list setting, refusing to empty it. */
  function toggle<T>(list: T[], value: T, order: T[]): T[] | null {
    const has = list.includes(value);
    if (has && list.length === 1) return null;
    const next = has ? list.filter((v) => v !== value) : [...list, value];
    return order.filter((v) => next.includes(v));
  }

  return (
    <>
      <Row label={t.directions}>
        {DIRECTIONS.map((direction) => (
          <Choice
            key={direction}
            active={settings.directions.includes(direction)}
            onClick={() => {
              const next = toggle(settings.directions, direction, DIRECTIONS);
              if (next) onChange({ ...settings, directions: next });
            }}
          >
            {t[DIRECTION_LABELS[direction]]}
          </Choice>
        ))}
      </Row>

      <Row label={t.patterns}>
        {PATTERN_IDS.map((pattern: PatternId) => (
          <Choice
            key={pattern}
            active={settings.patterns.includes(pattern)}
            onClick={() => {
              const next = toggle(settings.patterns, pattern, PATTERN_IDS);
              if (next) onChange({ ...settings, patterns: next });
            }}
          >
            {patternLabel(pattern)}
          </Choice>
        ))}
      </Row>

      <Row label={t.keysScope}>
        {(['all', 'songbook'] as KeyScope[]).map((scope) => (
          <Choice
            key={String(scope)}
            active={settings.keys === scope}
            onClick={() => onChange({ ...settings, keys: scope })}
            title={scope === 'all' ? t.keysAllTitle : t.keysSongbookTitle}
          >
            {scope === 'all' ? t.keysAll : t.keysSongbook}
          </Choice>
        ))}
      </Row>

      {/* The keys themselves, under the two presets rather than instead of them. A preset draws
          here as what it resolves to — `songbook` resolves per pattern, so there is no list to
          show it by — and touching any key turns that resolved set into an explicit one, which is
          what makes the row an edit of what you were already practising rather than a fresh start.

          This is the control that pays for the ordering axis: every ordering of a pattern is its
          own card, so the deck is `n!` per key and narrowing to a few is how it stays a deck you
          can finish. The start screen's `/{total}` tile prints the consequence. */}
      <Row label={t.keysPick}>
        {TONICS.map((tonic) => {
          const chosen = Array.isArray(settings.keys) ? settings.keys : resolved;
          const active = chosen.includes(tonic);
          return (
            <Choice
              key={tonic}
              active={active}
              onClick={() => {
                if (active && chosen.length === 1) return;
                const next = active
                  ? chosen.filter((pc) => pc !== tonic)
                  : [...chosen, tonic].sort((a, b) => a - b);
                onChange({ ...settings, keys: next });
              }}
              title={t.keysPickTitle}
            >
              {pitchClassLabel(tonic, padNotation)}
            </Choice>
          );
        })}
      </Row>

      <Row label={t.notations}>
        {NOTATIONS.map((notation) => (
          <Choice
            key={notation}
            active={settings.notations.includes(notation)}
            onClick={() => {
              const next = toggle(settings.notations, notation, NOTATIONS);
              if (next) onChange({ ...settings, notations: next });
            }}
            title={t[NOTATION_TITLES[notation]]}
          >
            {NOTATION_SAMPLES[notation]}
          </Choice>
        ))}
      </Row>

    </>
  );
}
