/**
 * One communiqué, drawn.
 *
 * Shared by the feed's three sections rather than written per section, because the difference
 * between them is which list a card is in and not what a card says — and a card that changed shape
 * depending on its section would make the sections impossible to compare, which is the one thing
 * the `Everything else` section exists for.
 *
 * The badges are the honest half. A card says which of four states its reading is in — read, never
 * read, nothing to read, read and since edited — because "no stations are closed" and "nobody has
 * looked" are the two answers this app must never let blur together, and the second one is why an
 * unread metro notice is sitting in the loud section at all.
 *
 * The fourth state is the newest and it was bought expensively. WTP's feeds carry the headline
 * rather than the communiqué, so a metro item can be *unreadable* rather than unread — and drawn as
 * "not read yet" it would look like a queue that is about to move, when in fact nothing is coming.
 * See `hasProse`.
 */
import type { ImpactVerdict, TransitItem } from '../../utils/transit/types';
import { extractionIsStale, isMetro } from '../../utils/transit/feed';
import { hasProse } from '../../utils/transit/normalize';
import { translations, whenLabel, type Lang } from './translations';

interface Props {
  item: TransitItem;
  verdict: ImpactVerdict | null;
  lang: Lang;
}

export default function NoticeCard({ item, verdict, lang }: Props) {
  const t = translations[lang];
  /*
   * Only worth saying about an item somebody was going to read: a bus communiqué is a headline too
   * and nothing was ever going to open it. `isMetro` is the same gate the coverage line counts on.
   *
   * It is **not** conditioned on `extractHash` being absent, which is what makes it work on the
   * corpus as it stands: every metro item read before `hasProse` existed carries a reading taken
   * from a headline, and drawn as a reading it is the card that started all this — *No station
   * closed*, about a line cut in half. `impactOf` makes the same call for the same reason.
   */
  const unreadable = isMetro(item) && !hasProse(item);
  const unread = item.extractHash === undefined || unreadable;
  const stale = !unreadable && extractionIsStale(item);

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
            {unreadable ? t.noProse : item.extractError ? t.unreadFailed : t.unread}
          </span>
        ) : null}
        {stale ? <span className="ev-chip tr-chip--stale">{t.stale}</span> : null}
      </p>

      {/*
        * The whole reading, and it is drawn only when there was something to read it from. A stored
        * `closedStops: []` on a headline-only item is not "no station is closed" — it is a model
        * answering the only question it could about one sentence — and printing it is precisely the
        * card that started this: **No station closed**, above a line running in two halves.
        */}
      {unreadable ? null : (
        <>
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
        </>
      )}

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
