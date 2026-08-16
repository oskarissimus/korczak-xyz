/*
 * Scope and session shape, as a Win95 dialog.
 *
 * Every control is a row of pressed-or-raised buttons rather than a select or a slider: the option
 * sets are tiny and fixed, and a pressed button says which one is current without being opened.
 * The same panel the fretboard trainer draws, over a different scope.
 *
 * Nothing here can produce an empty deck — the last direction, the last pattern and the last
 * notation cannot be switched off, because a deck of nothing is a game that cannot start and an
 * error message nobody needs to read.
 */

import type { ReactNode } from 'react';
import { DIRECTIONS } from '../../utils/transpose/cards';
import type { Direction } from '../../utils/transpose/cards';
import { NOTATIONS, PATTERN_IDS, patternLabel } from '../../utils/transpose/theory';
import type { Notation, PatternId } from '../../utils/transpose/theory';
import type { KeyScope, Settings } from '../../utils/transpose/types';
import type { Translation } from './translations';

interface SettingsPanelProps {
  settings: Settings;
  onChange: (next: Settings) => void;
  t: Translation;
}

// Exported so `TransposeSkeleton.astro` can lay out the same buttons rather than approximate them.
export const LENGTH_CHOICES = [10, 20, 40];
export const NEW_CHOICES = [3, 6, 10];

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

/*
 * The row label names the group as well as printing it. Without that it is loose text beside a run
 * of buttons, and several of these rows are near-symbols: the notation row alone announces `C#·a·H`
 * and `Cis·a·H` with nothing said about what they are toggling.
 */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tp-setting">
      <span className="tp-setting-label">{label}</span>
      <div className="tp-setting-controls" role="group" aria-label={label}>
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
      className={`tp-choice${active ? ' tp-choice--on' : ''}`}
      onClick={onClick}
      aria-pressed={active}
      title={title}
    >
      {children}
    </button>
  );
}

export default function SettingsPanel({ settings, onChange, t }: SettingsPanelProps) {
  /** Toggle one value of a list setting, refusing to empty it. */
  function toggle<T>(list: T[], value: T, order: T[]): T[] | null {
    const has = list.includes(value);
    if (has && list.length === 1) return null;
    const next = has ? list.filter((v) => v !== value) : [...list, value];
    return order.filter((v) => next.includes(v));
  }

  return (
    <div className="tp-settings">
      <h3 className="tp-subhead">{t.settings}</h3>

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
            key={scope}
            active={settings.keys === scope}
            onClick={() => onChange({ ...settings, keys: scope })}
            title={scope === 'all' ? t.keysAllTitle : t.keysSongbookTitle}
          >
            {scope === 'all' ? t.keysAll : t.keysSongbook}
          </Choice>
        ))}
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
    </div>
  );
}
