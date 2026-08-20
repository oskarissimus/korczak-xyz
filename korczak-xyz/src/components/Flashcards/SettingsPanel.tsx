/*
 * One settings dialog for a deck made of two.
 *
 * Three rows of its own — which decks a sitting draws from, how long it runs, how many unseen cards
 * it may introduce — and then each trainer's own scope rows under a heading. The trainers' rows are
 * their own files still (`Fretboard/SettingsPanel.tsx`, `Transpose/SettingsPanel.tsx`), because a
 * scope belongs to the deck it describes; what this file owns is the sitting.
 *
 * The `Decks` row toggles like the directions rows below it — either or both — and refuses to empty
 * itself, for the reason nothing else here can either: a deck of nothing is a game that cannot
 * start and an error message nobody needs to read.
 */

import type { Settings as FretboardSettings } from '../../utils/fretboard/types';
import type { LibraryIndex } from '../../utils/transpose/library';
import type { Settings as TransposeSettings } from '../../utils/transpose/types';
import { TRAINERS, type TrainerId } from '../../utils/flashcards/trainers';
import type { Settings } from '../../utils/flashcards/settings';
import FretboardSettingsRows from '../Fretboard/SettingsPanel';
import TransposeSettingsRows from '../Transpose/SettingsPanel';
import type { Translation as FretboardTranslation } from '../Fretboard/translations';
import type { Translation as TransposeTranslation } from '../Transpose/translations';
import { Choice, Row } from './controls';
import { type Translation } from './translations';

// Exported so the pre-hydration stand-in lays out the same buttons rather than approximating them.
export const LENGTH_CHOICES = [10, 20, 40];
export const NEW_CHOICES = [3, 6, 10];

interface SettingsPanelProps {
  settings: Settings;
  onChange: (next: Settings) => void;
  fretboardSettings: FretboardSettings;
  onFretboardChange: (next: FretboardSettings) => void;
  transposeSettings: TransposeSettings;
  onTransposeChange: (next: TransposeSettings) => void;
  /** The chord rows' key picker draws `songbook` as the keys it resolves to, which only this knows. */
  library: LibraryIndex;
  t: Translation;
  fretboardT: FretboardTranslation;
  transposeT: TransposeTranslation;
}

const DECK_LABELS: Record<TrainerId, { label: keyof Translation; title: keyof Translation }> = {
  fretboard: { label: 'deckNeck', title: 'deckNeckTitle' },
  transpose: { label: 'deckChords', title: 'deckChordsTitle' },
};

export default function SettingsPanel({
  settings,
  onChange,
  fretboardSettings,
  onFretboardChange,
  transposeSettings,
  onTransposeChange,
  library,
  t,
  fretboardT,
  transposeT,
}: SettingsPanelProps) {
  const toggleTrainer = (trainer: TrainerId) => {
    const has = settings.trainers.includes(trainer);
    if (has && settings.trainers.length === 1) return;
    const next = has
      ? settings.trainers.filter((id) => id !== trainer)
      : [...settings.trainers, trainer];
    // Kept in registry order, so the row and the settings record read the same way round.
    onChange({ ...settings, trainers: TRAINERS.filter((id) => next.includes(id)) });
  };

  return (
    <div className="fb-settings">
      <h3 className="fb-subhead">{t.settings}</h3>

      <Row label={t.decks}>
        {TRAINERS.map((trainer) => (
          <Choice
            key={trainer}
            active={settings.trainers.includes(trainer)}
            onClick={() => toggleTrainer(trainer)}
            title={t[DECK_LABELS[trainer].title]}
          >
            {t[DECK_LABELS[trainer].label]}
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

      {/* The scopes stay visible with their deck switched off: turning a deck off for one sitting is
          not the same as forgetting what it was set to, and a row that vanishes is a row you have to
          go looking for. */}
      <h4 className="fb-subhead fb-subhead--deck">{t.neckSettings}</h4>
      <FretboardSettingsRows
        settings={fretboardSettings}
        onChange={onFretboardChange}
        t={fretboardT}
      />

      <h4 className="fb-subhead fb-subhead--deck">{t.chordSettings}</h4>
      <TransposeSettingsRows
        settings={transposeSettings}
        onChange={onTransposeChange}
        library={library}
        t={transposeT}
      />
    </div>
  );
}
