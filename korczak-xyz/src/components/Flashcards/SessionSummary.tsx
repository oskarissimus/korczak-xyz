/*
 * What the sitting came to — across both decks, because it was one sitting.
 *
 * Six figures and a short list. The list is the part worth reading: the cards that were missed, named
 * in full, so the summary ends with something to do rather than a score. Each line is named by the
 * trainer that owns the card, through its own `describeCard` and its own translation table.
 *
 * The two "see progress" links are two, because the histories are two. That is the merge's whole
 * shape restated in a button row: one sitting, two records.
 */

import { formatSeconds } from '../../utils/srs/history';
import type { SessionSummary as Summary } from '../../utils/srs/history';
import { unqualify } from '../../utils/flashcards/trainers';
import type { Notation as FretboardNotation } from '../../utils/fretboard/notes';
import { describeCard as describeNeckCard } from '../Fretboard/describeCard';
import { describeCard as describeChordCard } from '../Transpose/describeCard';
import type { Translation as FretboardTranslation } from '../Fretboard/translations';
import type { Translation as TransposeTranslation } from '../Transpose/translations';
import { type Translation } from './translations';

interface SummaryProps {
  /** Built over *qualified* card ids, so each missed line can be named by its own trainer. */
  summary: Summary;
  masteredBefore: number;
  masteredAfter: number;
  neckStatsHref: string;
  chordStatsHref: string;
  t: Translation;
  fretboardT: FretboardTranslation;
  transposeT: TransposeTranslation;
  /** Only for a neck card that reads the same under both notations, which has none of its own. */
  notation: FretboardNotation;
  onAgain: () => void;
  onDone: () => void;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="fb-tile">
      <span className="fb-tile-value">{value}</span>
      <span className="fb-tile-label">{label}</span>
    </div>
  );
}

export default function SessionSummary({
  summary,
  masteredBefore,
  masteredAfter,
  neckStatsHref,
  chordStatsHref,
  t,
  fretboardT,
  transposeT,
  notation,
  onAgain,
  onDone,
}: SummaryProps) {
  const gained = masteredAfter - masteredBefore;

  const describe = (qualified: string): string => {
    const split = unqualify(qualified);
    if (!split) return qualified;
    return split.trainer === 'fretboard'
      ? describeNeckCard(split.cardId, fretboardT, notation)
      : describeChordCard(split.cardId, transposeT);
  };

  return (
    <div className="fb-summary">
      <h2 className="fb-summary-title">{t.summaryTitle}</h2>

      <div className="fb-tiles">
        <Tile label={t.answered} value={String(summary.answers)} />
        <Tile label={t.accuracy} value={`${Math.round(summary.accuracy * 100)}%`} />
        <Tile label={t.avgTime} value={formatSeconds(summary.avgMs)} />
        <Tile
          label={t.fastest}
          value={summary.fastestMs == null ? '—' : formatSeconds(summary.fastestMs)}
        />
        <Tile label={t.cardsSeen} value={String(summary.cards)} />
        <Tile label={t.newlyMastered} value={gained > 0 ? `+${gained}` : String(gained)} />
      </div>

      {summary.missed.length > 0 && (
        <div className="fb-missed">
          <h3 className="fb-subhead">{t.missedCards}</h3>
          <ul className="fb-missed-list">
            {summary.missed.slice(0, 8).map(({ cardId, misses }) => (
              <li key={cardId}>
                {describe(cardId)}
                {misses > 1 && <span className="fb-missed-count"> ×{misses}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="fb-actions">
        <button type="button" className="fb-btn fb-btn--primary" onClick={onAgain}>
          {t.again}
        </button>
        <button type="button" className="fb-btn" onClick={onDone}>
          {t.backToStart}
        </button>
        <a className="fb-btn" href={neckStatsHref}>
          {t.seeNeckStats}
        </a>
        <a className="fb-btn" href={chordStatsHref}>
          {t.seeChordStats}
        </a>
      </div>
    </div>
  );
}
