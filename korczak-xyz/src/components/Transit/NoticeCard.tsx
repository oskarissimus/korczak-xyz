/**
 * One communiqué, drawn.
 *
 * Shared by the feed's three sections rather than written per section, because the difference
 * between them is which list a card is in and not what a card says — and a card that changed shape
 * depending on its section would make the sections impossible to compare, which is the one thing
 * the `Everything else` section exists for.
 *
 * The badges are the honest half. A card says which of three states its reading is in — read,
 * never read, read and since edited — because "no stations are closed" and "nobody has looked" are
 * the two answers this app must never let blur together, and the second one is why an unread metro
 * notice is sitting in the loud section at all.
 */
import type { ImpactVerdict, TransitItem } from '../../utils/transit/types';
import { extractionIsStale } from '../../utils/transit/feed';
import { translations, whenLabel, type Lang } from './translations';

interface Props {
  item: TransitItem;
  verdict: ImpactVerdict | null;
  lang: Lang;
}

export default function NoticeCard({ item, verdict, lang }: Props) {
  const t = translations[lang];
  const unread = item.extractHash === undefined;
  const stale = extractionIsStale(item);

  return (
    <article className={`ev-card tr-card${verdict?.impact === 'route' ? ' tr-card--route' : ''}`}>
      <div className="ev-card-top">
        <h3 className="ev-card-title">
          <a className="ev-link" href={item.url} target="_blank" rel="noopener noreferrer">
            {item.summary ?? item.title}
          </a>
        </h3>
        <span className="ev-card-when">{whenLabel(item.publishedAt, lang)}</span>
      </div>

      <p className="ev-card-meta">
        {item.titleLines
          .filter((line) => line === 'M1' || line === 'M2')
          .map((line) => (
            <span key={line} className={`tr-line tr-line--${line.toLowerCase()}`}>
              {line}
            </span>
          ))}
        <span className="ev-chip">
          {item.feed === 'change' ? t.kindChange : t.kindImpediment}
        </span>
        {/*
          * The reading's state, always. Without it there is no telling whether a quiet card is
          * quiet because the notice closes nothing or because nobody has read it — and only one of
          * those is a reason to open the link.
          */}
        {unread ? (
          <span className="ev-chip tr-chip--unread">
            {item.extractError ? t.unreadFailed : t.unread}
          </span>
        ) : null}
        {stale ? <span className="ev-chip tr-chip--stale">{t.stale}</span> : null}
      </p>

      {item.wholeLine ? (
        <p className="tr-stops tr-stops--whole">{t.wholeLine}</p>
      ) : item.closedStops && item.closedStops.length > 0 ? (
        <p className="tr-stops">
          <span className="tr-stops-label">{t.closedStops}:</span>{' '}
          {item.closedStops.map((stop) => (
            <span
              key={stop}
              className={`tr-stop${verdict?.stops.includes(stop) ? ' tr-stop--mine' : ''}`}
            >
              {stop}
            </span>
          ))}
        </p>
      ) : item.closedStops ? (
        <p className="tr-stops tr-stops--none">{t.noClosure}</p>
      ) : null}

      <p className="ev-card-sub">
        {item.reason ? (
          <span className="tr-reason">
            {t.reason}: {item.reason}
          </span>
        ) : null}
        {item.effectiveFrom !== undefined ? (
          <span className="tr-when">
            {t.from} {whenLabel(item.effectiveFrom, lang)}
            {item.effectiveUntil !== undefined
              ? ` ${t.until} ${whenLabel(item.effectiveUntil, lang)}`
              : ''}
          </span>
        ) : null}
      </p>

      {/*
        * The headline is drawn even though the summary took the title's place above it. It is WTP's
        * own words and the line list they publish, and the card's whole claim is that it is a
        * reading of that — so the thing being read has to be on screen beside the reading.
        */}
      <p className="tr-source-title">{item.title}</p>

      {verdict && verdict.stops.length > 0 ? (
        <p className="ev-card-sub tr-mine">
          {t.yourStops}: {verdict.stops.join(', ')}
        </p>
      ) : null}

      <p className="ev-actions">
        <a className="ev-action" href={item.url} target="_blank" rel="noopener noreferrer">
          {t.openNotice}
        </a>
      </p>
    </article>
  );
}
