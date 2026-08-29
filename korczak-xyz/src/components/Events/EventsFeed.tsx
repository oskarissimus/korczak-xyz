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
  classificationCoverage,
  countryTally,
  placeLabel,
  whenLabel,
  type FeedGroup,
  type FeedItem,
  type FeedMode,
} from '../../utils/events/feed';
import { countryLabel } from '../../utils/events/countries';
import type { Reach } from '../../utils/events/types';
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
  const [mode, setMode] = useState<FeedMode>('matched');

  // Re-arm silently. Nothing is rendered for it here — the Alerts tab is where push has a UI.
  useWebPush(auth.user, lang, { verifyOnly: true });

  const now = Date.now();
  const sections = useMemo(
    () => buildFeed(feed.events, interests, now, { mode }),
    // `now` is deliberately not a dependency: re-grouping on every render would rebuild the list
    // for a clock tick nobody can see. It is recomputed when the data actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed.events, interests, mode],
  );

  if (!feed.ready || !ready) return <div className="ev-loading" />;

  const items = sections.flatMap((section) => section.items);
  const shown = items.length;
  const rejecting = mode === 'rejected-place';
  const coverage = classificationCoverage(feed.events);

  return (
    <div className="ev-feed">
      <section className="ev-section">
        <h2 className="ev-subhead">{t.feedHeading}</h2>
        <div className="ev-toolbar">
          <span>{fill(t.showingCount, { shown, total: feed.events.length })}</span>
          {/*
            * Three states rather than a link that toggles, because a toggling link's label always
            * names one of the two and leaves you working out whether it is where you are or where
            * you would go. Here the pressed button is the answer.
            */}
          <div className="ev-views" role="group" aria-label={t.feedHeading}>
            {(
              [
                ['matched', t.viewMatched],
                ['rejected-place', t.viewRejected],
                ['all', t.viewAll],
              ] as Array<[FeedMode, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`ev-view${mode === value ? ' ev-view--on' : ''}`}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {feed.error ? <span className="ev-sync ev-sync--bad">✕ {feed.error}</span> : null}
        </div>

        {rejecting ? (
          <div className="ev-verify">
            <p className="ev-hint">{t.rejectedIntro}</p>
            {/*
              * Two different questions, so two lines. The tally says what is being removed and in
              * what shape — four countries once each reads very differently from forty rows under
              * one, which is a classifier getting a country wrong at scale. The coverage line is
              * the half this list structurally cannot show: an unlabelled event *passes* the
              * places rule, so it is never here, and a classifier that has stopped looks exactly
              * like a filter with nothing to remove.
              */}
            {shown > 0 ? (
              <p className="ev-tally">
                <span className="ev-tally-head">{t.placesTally}</span>{' '}
                {countryTally(items.map((i) => i.event))
                  .map(({ code, count }) => `${countryLabel(code)} ${count}`)
                  .join(' · ')}
              </p>
            ) : null}
            <p className="ev-tally">
              {fill(t.classifiedCount, {
                classified: coverage.classified,
                total: coverage.total,
              })}
            </p>
          </div>
        ) : null}
      </section>

      {sections.length === 0 ? (
        <div className="ev-empty">
          <p>{rejecting ? t.rejectedEmpty : t.feedEmpty}</p>
          <p className="ev-hint">{rejecting ? t.rejectedEmptyHint : t.feedEmptyHint}</p>
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

/**
 * What the classifier decided, in words.
 *
 * Absent is its own case and says so rather than printing nothing: a blank where a label goes and
 * a label that has not arrived yet look identical, and only one of them is a reason for an event
 * to still be in the feed.
 */
function reachLabel(reach: Reach | undefined, t: Translation): string {
  if (reach === 'local') return t.reachLocal;
  if (reach === 'national') return t.reachNational;
  if (reach === 'international') return t.reachInternational;
  return t.reachUnknown;
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
        {item.rejectedBy?.length ? (
          <span>
            {t.rejectedBy} {item.rejectedBy.map((i) => i.label).join(', ')}
          </span>
        ) : null}
        {/*
          * On every card in every view, not only the rejected ones. Without it there is no telling
          * whether something stayed because the filter judged it right or because it has not been
          * judged at all — which is the difference between a working filter and one that has not
          * started.
          */}
        <span className="ev-chip ev-chip--place">
          {countryLabel(event.country)} · {reachLabel(event.reach, t)}
        </span>
        {placeLabel(event) ? <span>{placeLabel(event)}</span> : null}
        <span>{event.sourceName}</span>
        <span>{fill(t.announcedAgo, { when: relativeTime(event.firstSeenAt, now, t) })}</span>
      </div>

      {/* The model's own sentence, so a verdict can be argued with rather than only obeyed. */}
      {item.rejectedBy?.length && event.reachReason ? (
        <p className="ev-reason">{event.reachReason}</p>
      ) : null}

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


