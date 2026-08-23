/**
 * The Feed tab: what is coming up that matches an interest.
 *
 * Also where the push subscription is re-verified. That is deliberate and not just convenience:
 * iOS drops subscriptions silently after a few weeks and has no `pushsubscriptionchange`, so the
 * only defence is checking on launch — and this is the tab the icon opens. Hanging that check off
 * the Alerts tab alone would mean it never runs.
 */
import { useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useEventFeed } from '../../hooks/useEventFeed';
import { useEventInterests } from '../../hooks/useEventInterests';
import { useWebPush } from '../../hooks/useWebPush';
import {
  buildFeed,
  placeLabel,
  whenLabel,
  type FeedGroup,
  type FeedItem,
} from '../../utils/events/feed';
import EventsGate from './EventsGate';
import {
  fill,
  localeOf,
  relativeTime,
  translations,
  type Lang,
  type Translation,
} from './translations';

interface Props {
  lang: Lang;
}

export default function EventsFeed({ lang }: Props) {
  const auth = useAuth();
  return (
    <EventsGate auth={auth} lang={lang} path="/">
      <FeedPanel lang={lang} />
    </EventsGate>
  );
}

function FeedPanel({ lang }: Props) {
  const auth = useAuth();
  const feed = useEventFeed(auth.user);
  const { interests, ready } = useEventInterests(auth.user);
  const t = translations[lang];
  const [matchedOnly, setMatchedOnly] = useState(true);

  // Re-arm silently. Nothing is rendered for it here — the Alerts tab is where push has a UI.
  useWebPush(auth.user, lang, { verifyOnly: true });

  const now = Date.now();
  const sections = useMemo(
    () => buildFeed(feed.events, interests, now, { matchedOnly }),
    // `now` is deliberately not a dependency: re-grouping on every render would rebuild the list
    // for a clock tick nobody can see. It is recomputed when the data actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed.events, interests, matchedOnly],
  );

  if (!feed.ready || !ready) return <div className="ev-loading" />;

  const shown = sections.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <div className="ev-feed">
      <section className="ev-section">
        <h2 className="ev-subhead">{t.feedHeading}</h2>
        <div className="ev-toolbar">
          <span>{fill(t.showingCount, { shown, total: feed.events.length })}</span>
          <button type="button" className="ev-link" onClick={() => setMatchedOnly((v) => !v)}>
            {matchedOnly ? t.allEvents : t.matchedOnly}
          </button>
          {feed.error ? <span className="ev-sync ev-sync--bad">✕ {feed.error}</span> : null}
        </div>
      </section>

      {sections.length === 0 ? (
        <div className="ev-empty">
          <p>{t.feedEmpty}</p>
          <p className="ev-hint">{t.feedEmptyHint}</p>
        </div>
      ) : (
        sections.map((section) => (
          <section className="ev-group" key={section.group}>
            <h3 className="ev-group-head">{groupLabel(section.group, t)}</h3>
            <ul className="ev-list">
              {section.items.map((item) => (
                <EventCard key={item.event.id} item={item} lang={lang} now={now} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function groupLabel(group: FeedGroup, t: Translation): string {
  if (group === 'week') return t.groupThisWeek;
  if (group === 'month') return t.groupThisMonth;
  if (group === 'later') return t.groupLater;
  return t.groupUndated;
}

function EventCard({ item, lang, now }: { item: FeedItem; lang: Lang; now: number }) {
  const t = translations[lang];
  const { event } = item;

  return (
    <li className="ev-card">
      <div className="ev-card-top">
        <span className="ev-card-when">{whenLabel(event, localeOf(lang))}</span>
        <h4 className="ev-card-title">{event.title}</h4>
      </div>

      {event.subtitle ? <p className="ev-card-sub">{event.subtitle}</p> : null}

      <div className="ev-card-meta">
        {event.ticketUrl ? <span className="ev-chip ev-chip--sale">{t.onSaleNow}</span> : null}
        {item.matched.length > 0 ? (
          <span>
            {t.matchedBy} {item.matched.map((i) => i.label).join(', ')}
          </span>
        ) : null}
        {placeLabel(event) ? <span>{placeLabel(event)}</span> : null}
        <span>{event.sourceName}</span>
        <span>{fill(t.announcedAgo, { when: relativeTime(event.firstSeenAt, now, t) })}</span>
      </div>

      <div className="ev-actions">
        {/* rel is not optional on a link built from scraped markup. */}
        <a className="ev-link" href={event.url} target="_blank" rel="noopener noreferrer">
          {t.moreInfo}
        </a>
        {event.ticketUrl ? (
          <a className="ev-link" href={event.ticketUrl} target="_blank" rel="noopener noreferrer">
            {t.tickets}
          </a>
        ) : null}
      </div>
    </li>
  );
}


