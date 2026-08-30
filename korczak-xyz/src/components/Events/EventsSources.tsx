/**
 * The Sources tab: which pages are read to produce this feed.
 *
 * The feed answers "what is on"; this answers "and how would I know if that were wrong". A scrape
 * that has quietly stopped matching, a festival blog nobody remembers adding, a listing that turned
 * up from somewhere unexpected — none of those are visible from a list of events, and the Alerts
 * tab's health table names sources without ever saying what a source *is*.
 *
 * Three facts are drawn per source and they are three different questions:
 *
 * - **The pages**, from `SOURCE_CATALOGUE` — the URLs the collector actually requests, as links, so
 *   the claim is checkable rather than just stated. This half is static: it needs no network, no
 *   pull and no collector run, so the tab says something useful on a dead connection and on an
 *   account whose first collection has not happened yet.
 * - **Health**, from `eventSources` — whether the last run got anything. Already on Alerts; here it
 *   sits against the pages it is about, which is where it can be acted on.
 * - **How much of the corpus is its** — because a source can be green, be read, and still be
 *   contributing nothing you would miss. That is not a failure and does not belong in the health
 *   table; it is the thing you look at before deciding a scrape is worth its fixture.
 *
 * Behind the sign-in gate like every other tab. The catalogue itself is a static fact and would
 * render fine signed out, but two of the three columns would be empty and one tab behaving unlike
 * the other three is worse than the consistency is worth.
 */
import { useEffect, useMemo, useState } from 'react';
import { describeError, log } from '../../lib/logger';
import { useAuth } from '../../hooks/useAuth';
import { useEventFeed } from '../../hooks/useEventFeed';
import { pullSourceHealth } from '../../utils/events/browser/cloud';
import { countryLabel } from '../../utils/events/countries';
import { SOURCE_CATALOGUE, type SourceKind, type SourcePage } from '../../utils/events/sources';
import type { EventRecord, SourceHealth } from '../../utils/events/types';
import EventsGate from './EventsGate';
import { sourceName, sourceNote } from './sourceNames';
import { fill, relativeTime, translations, type Lang, type Translation } from './translations';

interface Props {
  lang: Lang;
}

export default function EventsSources({ lang }: Props) {
  const auth = useAuth();
  return (
    <EventsGate auth={auth} lang={lang} path="/sources/">
      <SourcesPanel lang={lang} />
    </EventsGate>
  );
}

function SourcesPanel({ lang }: Props) {
  const auth = useAuth();
  const feed = useEventFeed(auth.user);
  const t = translations[lang];
  const now = Date.now();

  const [health, setHealth] = useState<SourceHealth[]>([]);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.user) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await pullSourceHealth();
        if (!cancelled) {
          setHealth(rows);
          setHealthError(null);
        }
      } catch (e) {
        // Never swallowed. A panel whose job is telling you what is broken must not be the
        // quietest thing on the page — the Alerts tab learnt that from an empty `catch`.
        if (cancelled) return;
        log.warn('events.sources.pull.failed', describeError(e));
        setHealthError(String(describeError(e).message ?? 'load failed'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.user]);

  const counts = useMemo(() => countBySource(feed.events), [feed.events]);
  const byId = useMemo(() => new Map(health.map((row) => [row.id, row])), [health]);

  /*
   * A health row nothing in the catalogue describes.
   *
   * The classifier is one — it writes beside the scrapes because it fails the same way, and it is
   * not a page. A source deleted from the catalogue but still collecting would be another, and
   * that one is worth seeing. Rather than special-casing the id we know about, both are listed
   * under a heading that says exactly what they are: reporting, and not a page here.
   */
  const unlisted = health.filter((row) => !SOURCE_CATALOGUE.some((e) => e.id === row.id));

  return (
    <div className="ev-sources-tab">
      <section className="ev-section">
        <h2 className="ev-subhead">{t.sourcesTabHeading}</h2>
        <p className="ev-hint">{t.sourcesIntro}</p>
        {healthError ? (
          <p className="ev-error" role="alert">
            {healthError}
          </p>
        ) : null}
      </section>

      <ul className="ev-source-list">
        {SOURCE_CATALOGUE.map((entry) => {
          const row = byId.get(entry.id);
          const failing = (row?.consecutiveFailures ?? 0) > 0;
          return (
            <li className={`ev-source${failing ? ' ev-source--bad' : ''}`} key={entry.id}>
              <div className="ev-source-head">
                <h3 className="ev-source-name">{sourceName(entry.id, entry.label, t)}</h3>
                <span className="ev-chip">{kindLabel(entry.kind, t)}</span>
                {entry.needsKey ? (
                  <span className="ev-chip">{fill(t.sourceNeedsKey, { name: entry.needsKey })}</span>
                ) : null}
              </div>

              <p className="ev-source-note">{sourceNote(entry.id, t)}</p>

              <ul className="ev-pages">
                {entry.pages(now).map((page) => (
                  <li className="ev-page" key={page.url}>
                    {/* rel is not optional on a link to somewhere we scrape. */}
                    <a
                      className="ev-link ev-page-url"
                      href={page.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {page.label}
                    </a>
                    <span className="ev-page-meta">{pageMeta(page, t)}</span>
                  </li>
                ))}
              </ul>

              <p className="ev-source-status">
                {/*
                  * Two independent facts on one line, and the order is the order they answer in:
                  * did the collector get anything last time, and is any of it still in the feed.
                  * A green source contributing nothing is not a fault and must not read as one.
                  */}
                <span className={failing ? 'ev-status ev-status--bad' : 'ev-status'}>
                  {healthLabel(row, now, t)}
                </span>
                {/*
                  * A chip rather than more grey text after a separator. Spaced apart the two read
                  * as one run-on sentence, and a `·` between them orphans onto the second line at
                  * 320px, where it reads as a bullet. Different shapes need no punctuation.
                  */}
                {feed.ready ? (
                  <span className="ev-chip">
                    {fill(t.sourceInCorpus, { count: counts.get(entry.id) ?? 0 })}
                  </span>
                ) : null}
              </p>
            </li>
          );
        })}
      </ul>

      {unlisted.length > 0 ? (
        <section className="ev-section">
          <h3 className="ev-subhead">{t.sourcesUnlistedHeading}</h3>
          <p className="ev-hint">{t.sourcesUnlistedHint}</p>
          <ul className="ev-sources">
            {unlisted.map((row) => (
              <li
                className={`ev-row${row.consecutiveFailures > 0 ? ' ev-row--bad' : ''}`}
                key={row.id}
              >
                {/* Falls back to the record's own label by definition — nothing here is in the
                    catalogue — but going through the same helper is what keeps it true if one
                    ever is. */}
                <span className="ev-row-main">{sourceName(row.id, row.label, t)}</span>
                <span className="ev-row-meta">{healthLabel(row, now, t)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** How many of the events this browser holds came from each source. */
function countBySource(events: EventRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.source, (counts.get(event.source) ?? 0) + 1);
  return counts;
}

function kindLabel(kind: SourceKind, t: Translation): string {
  if (kind === 'scrape') return t.kindScrape;
  if (kind === 'ical') return t.kindIcal;
  if (kind === 'rss') return t.kindRss;
  return t.kindApi;
}

/**
 * What a page stamps on everything it yields, plus whether its absence is normal.
 *
 * Shown because a keyword-less interest has no second filter — a tag applied feed-wide *is* the
 * whole of what reaches it, which is the mistake this app has made from three different directions.
 * Being able to read a source's blanket tags off the page it comes from is what makes the next one
 * catchable before it ships.
 */
function pageMeta(page: SourcePage, t: Translation): string {
  const parts: string[] = [];
  if (page.tags?.length) parts.push(page.tags.join(' · '));
  const place = [page.city, page.country ? countryLabel(page.country) : undefined]
    .filter(Boolean)
    .join(', ');
  if (place) parts.push(place);
  if (page.optional) parts.push(t.pageOptional);
  return parts.join(' — ');
}

/**
 * A source's last run, in words.
 *
 * Three states and not two: never run is not the same as ran and found nothing, and only one of
 * them is a reason to go and look at the page.
 */
function healthLabel(row: SourceHealth | undefined, now: number, t: Translation): string {
  if (!row) return t.sourceNever;
  if (row.consecutiveFailures > 0) {
    return fill(t.sourceFailing, { when: row.lastOkAt ? relativeTime(row.lastOkAt, now, t) : '—' });
  }
  return `${fill(t.sourceOk, { count: row.lastCount })} · ${fill(t.sourceLastRun, {
    when: relativeTime(row.lastRunAt, now, t),
  })}`;
}
