/*
 * What the sitting came to.
 *
 * Six figures and a short list. The list is the part worth reading: the cards that were missed,
 * named in full, so the summary ends with something to do rather than a score.
 */

import { parseCardId } from '../../utils/transpose/cards';
import { formatSeconds } from '../../utils/transpose/stats';
import type { SessionSummary as Summary } from '../../utils/transpose/stats';
import {
  chordLabels,
  keyLabel,
  keyOf,
  patternLabel,
} from '../../utils/transpose/theory';
import type { Notation } from '../../utils/transpose/theory';
import type { Translation } from './translations';

interface SummaryProps {
  summary: Summary;
  masteredBefore: number;
  masteredAfter: number;
  statsHref: string;
  t: Translation;
  onAgain: () => void;
  onDone: () => void;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tp-tile">
      <span className="tp-tile-value">{value}</span>
      <span className="tp-tile-label">{label}</span>
    </div>
  );
}

/**
 * `A D E → C` / `I IV V in A` / `A D E — which key?`
 *
 * Named as the card named it, in the notation the card asked in, so a `degrees` card in `A` and the
 * same one asked in German names are two lines. Missing `A D E fis` and missing `A D E f#` are
 * different things to go back and look at, which is the whole reason they are two cards.
 */
export function describeCard(cardId: string, t: Translation): string {
  const key = parseCardId(cardId);
  if (!key) return cardId;
  const notation: Notation = key.notation;

  if (key.direction === 'transpose') {
    const from = chordLabels(key.from, key.pattern, notation).join(' ');
    return `${from} → ${keyLabel(keyOf(key.to, key.pattern), notation)}`;
  }
  if (key.direction === 'degrees') {
    return `${patternLabel(key.pattern)} ${t.askDegrees} ${keyLabel(
      keyOf(key.tonic, key.pattern),
      notation
    )}`;
  }
  return `${chordLabels(key.tonic, key.pattern, notation).join(' ')} — ${t.askKey}`;
}

export default function SessionSummary({
  summary,
  masteredBefore,
  masteredAfter,
  statsHref,
  t,
  onAgain,
  onDone,
}: SummaryProps) {
  const gained = masteredAfter - masteredBefore;
  return (
    <div className="tp-summary">
      <h2 className="tp-summary-title">{t.summaryTitle}</h2>

      <div className="tp-tiles">
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
        <div className="tp-missed">
          <h3 className="tp-subhead">{t.missedCards}</h3>
          <ul className="tp-missed-list">
            {summary.missed.slice(0, 8).map(({ cardId, misses }) => (
              <li key={cardId}>
                {describeCard(cardId, t)}
                {misses > 1 && <span className="tp-missed-count"> ×{misses}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="tp-actions">
        <button type="button" className="tp-btn tp-btn--primary" onClick={onAgain}>
          {t.again}
        </button>
        <button type="button" className="tp-btn" onClick={onDone}>
          {t.backToStart}
        </button>
        <a className="tp-btn" href={statsHref}>
          {t.seeStats}
        </a>
      </div>
    </div>
  );
}
