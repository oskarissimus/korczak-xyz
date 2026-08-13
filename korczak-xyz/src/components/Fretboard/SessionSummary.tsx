/*
 * What the sitting came to.
 *
 * Six figures and a short list. The list is the part worth reading: the positions that were
 * missed, named in full, so the summary ends with something to do rather than a score.
 */

import {
  asksEveryPlace,
  cardNoteLabel,
  cardNotation,
  isPositionKey,
  parseCardId,
  stringLabel,
} from '../../utils/fretboard/notes';
import type { Notation } from '../../utils/fretboard/notes';
import { formatSeconds } from '../../utils/fretboard/stats';
import type { SessionSummary as Summary } from '../../utils/fretboard/stats';
import { fill, type Translation } from './translations';

interface SummaryProps {
  summary: Summary;
  masteredBefore: number;
  masteredAfter: number;
  statsHref: string;
  t: Translation;
  notation: Notation;
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

/**
 * `A — D string, fret 7`: the note first, because that is what the card was about.
 *
 * Named as the card named it — under the spelling it asked and in the notation it asked in — so
 * the `find` cards on one black key are up to four separate lines. Missing `D♭` and missing `C♯`
 * are different things to go back and look at, and so are missing `C♯` and missing `Cis`.
 *
 * `display` only decides the string letter on a card that reads the same in both notations, where
 * there is nothing to take it from.
 */
export function describeCard(cardId: string, t: Translation, display: Notation): string {
  const key = parseCardId(cardId);
  if (!key) return cardId;
  // A `pitch` card names no place — several answer it — so the pitch and its octave are the line;
  // a select-all card wanted all of them, which is a different thing to go back and look at.
  if (!isPositionKey(key)) {
    return `${cardNoteLabel(key)} — ${asksEveryPlace(key) ? t.everywhereShort : t.anywhereShort}`;
  }
  const string = stringLabel(key.stringIndex, cardNotation(key, display));
  const where =
    key.fret === 0
      ? fill(t.a11yPositionOpen, { string })
      : fill(t.a11yPosition, { string, fret: key.fret });
  return `${cardNoteLabel(key)} — ${where}`;
}

export default function SessionSummary({
  summary,
  masteredBefore,
  masteredAfter,
  statsHref,
  t,
  notation,
  onAgain,
  onDone,
}: SummaryProps) {
  const gained = masteredAfter - masteredBefore;
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
                {describeCard(cardId, t, notation)}
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
        <a className="fb-btn" href={statsHref}>
          {t.seeStats}
        </a>
      </div>
    </div>
  );
}
