/**
 * The Feed tab: what the sources collected and has not happened yet. Cards, and nothing else.
 *
 * **There are no filters on this tab, and that is the design rather than an omission.** The feed is
 * the *output* of the pipeline — scrape, derive, classify — so everything deciding what lands here
 * is a fact about a source, and it is read where it is set: the Sources tab draws each source's
 * pages, its model passes, how much of the corpus is its, and the switch that silences it.
 *
 * Since the interests went (Sep 2026) there is no per-reader filter at all, which is the thing to
 * understand before wondering where a row came from: if it is here, a source you have left on
 * collected it and it has not happened yet. Narrowing is a change to an adapter or a tap on a
 * switch.
 *
 * Also where the push subscription is re-verified. That is deliberate and not just convenience:
 * iOS drops subscriptions silently after a few weeks and has no `pushsubscriptionchange`, so the
 * only defence is checking on launch — and this is the tab the icon opens. Hanging that check off
 * the Alerts tab alone would mean it never runs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useEventFeed } from '../../hooks/useEventFeed';
import { useEventSourcePrefs } from '../../hooks/useEventSourcePrefs';
import { useWebPush } from '../../hooks/useWebPush';
import {
  buildFeed,
  placeLabel,
  saleWhenLabel,
  whenLabel,
  type FeedGroup,
} from '../../utils/events/feed';
import { countryLabel } from '../../utils/events/countries';
import { eventFocusOf, FEED_PATH, localizePath, SOURCES_PATH } from '../../utils/events/links';
import { formatDistances } from '../../utils/events/distance';
import type { EventKind, EventRecord, Reach } from '../../utils/events/types';
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
  const switches = useEventSourcePrefs(auth.user);
  const t = translations[lang];
  /*
   * The event a notification asked for, read on the very first render rather than in an effect.
   *
   * A `useState` initialiser rather than a plain call, so the answer is fixed for the life of the
   * island: the one thing worse than arriving at the wrong row is a page that changes its mind
   * halfway through a visit.
   *
   * It no longer has to turn any filter off, which is the quiet dividend of this tab having none —
   * the note that used to explain three unexplained changes at once is now only ever about the row
   * itself being gone, or about the source it came from having been switched off since.
   */
  const [focus] = useState<string | null>(focusFromUrl);

  // Re-arm silently. Nothing is rendered for it here — the Alerts tab is where push has a UI.
  useWebPush(auth.user, lang, { verifyOnly: true });

  const now = Date.now();
  const sources = switches.prefs;
  const sections = useMemo(
    () => buildFeed(feed.events, now, { sources }),
    // `now` is deliberately not a dependency: re-grouping on every render would rebuild the list
    // for a clock tick nobody can see. It is recomputed when the data actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed.events, sources],
  );

  if (!feed.ready) return <div className="ev-loading" />;

  const events = sections.flatMap((section) => section.events);
  /*
   * Whether the row a notification pointed at is on the screen — by fingerprint, which is what the
   * link carries and what survives the dedupe, so the card the reader sees answers to it however
   * the two copies of one night were resolved.
   */
  const focusShown = focus !== null && events.some((event) => event.fingerprint === focus);
  /*
   * Said only once the network has answered, or failed to. A feed restored from the localStorage
   * cache is a few hours old and routinely lacks the very row the push was about, so announcing it
   * missing on the first frame would be wrong about half the taps and would correct itself a
   * second later — which reads as the app changing its mind.
   */
  const focusMissing = focus !== null && !focusShown && (feed.fresh || feed.error !== null);

  return (
    <div className="ev-feed">
      <section className="ev-section">
        <h2 className="ev-subhead">{t.feedHeading}</h2>
        <div className="ev-toolbar">
          <span>{fill(t.showingCount, { shown: events.length, total: feed.events.length })}</span>
          {feed.error ? <span className="ev-sync ev-sync--bad">✕ {feed.error}</span> : null}
        </div>

        {/*
          * Why the row a notification named is not here. The link back is the same page without the
          * query — which is all "clearing" means now that the tab has nothing to clear.
          */}
        {focusMissing ? (
          <p className="ev-note ev-focus-note">
            {t.focusMissing}{' '}
            <a className="ev-link" href={localizePath(FEED_PATH, lang)}>
              {t.focusClear}
            </a>
          </p>
        ) : null}
      </section>

      {sections.length === 0 ? (
        <div className="ev-empty">
          <p>{t.feedEmpty}</p>
          <p className="ev-hint">{t.feedEmptyHint}</p>
          {/*
            * The one thing that can empty this list, and its control is on another tab — so it
            * gets a link out rather than a button. A source switched off on a phone weeks ago
            * empties a laptop, and without this line there would be nothing on the screen saying
            * who asked for that.
            */}
          {switches.disabled.length > 0 ? (
            <a className="ev-link" href={localizePath(SOURCES_PATH, lang)}>
              {fill(t.sourcesOffHint, { count: switches.disabled.length })}
            </a>
          ) : null}
        </div>
      ) : (
        sections.map((section) => (
          <section className="ev-group" key={section.group}>
            <h3 className="ev-group-head">{groupLabel(section.group, t)}</h3>
            <ul className="ev-list">
              {section.events.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  lang={lang}
                  now={now}
                  focused={event.fingerprint === focus}
                />
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
 * Absent draws nothing, like `listing` — the place chip beside it already says `?` while the
 * classifier has not reached the row, and saying it twice on one line of chips is noise.
 */
function kindLabel(kind: EventKind | undefined, t: Translation): string | null {
  if (kind === 'announcement') return t.kindAnnouncement;
  if (kind === 'coverage') return t.kindCoverage;
  // `listing` and unclassified both draw nothing. Not for want of a word for them — a chip on
  // every card in the corpus saying "yes, this is an event" is a label nobody reads twice, and the
  // unlabelled case is already on the card: the place chip says `?` until this call has been made.
  return null;
}

function reachLabel(reach: Reach | undefined, t: Translation): string {
  if (reach === 'local') return t.reachLocal;
  if (reach === 'national') return t.reachNational;
  if (reach === 'international') return t.reachInternational;
  return t.reachUnknown;
}

/**
 * The event a deep link asked to show, or null.
 *
 * Guarded rather than trusting the island to be a browser: this component is `client:only`, so it
 * always is — but the guard costs a line and the alternative is a build-time crash in a component
 * nobody rendered on the server on purpose.
 */
function focusFromUrl(): string | null {
  return typeof window === 'undefined' ? null : eventFocusOf(window.location.search);
}

function groupLabel(group: FeedGroup, t: Translation): string {
  if (group === 'week') return t.groupThisWeek;
  if (group === 'month') return t.groupThisMonth;
  if (group === 'later') return t.groupLater;
  return t.groupUndated;
}

function EventCard({
  event,
  lang,
  now,
  focused = false,
}: {
  event: EventRecord;
  lang: Lang;
  now: number;
  /** The row a notification was about: outlined, and scrolled to once. */
  focused?: boolean;
}) {
  const t = translations[lang];
  const saleWhen = saleWhenLabel(event, localeOf(lang));
  const saleChip = saleWhen ? fill(t.saleOpens, { when: saleWhen }) : null;
  const card = useRef<HTMLLIElement>(null);

  /*
   * Brought into view, centred, and without animation.
   *
   * A smooth scroll here would be a page that arrives and then slides, which on a phone opening
   * from the lock screen reads as the app still loading; `center` rather than the default `start`
   * because a card pinned to the top edge looks like the top of the list rather than a place in it,
   * and the group heading above it is half of what says when the event is.
   *
   * Depends on `focused` alone: the effect must not re-run when the feed refreshes underneath, or
   * a pull landing while the reader has scrolled away would yank them back.
   */
  useEffect(() => {
    if (focused) card.current?.scrollIntoView({ block: 'center' });
  }, [focused]);

  return (
    <li className={`ev-card${focused ? ' ev-card--focus' : ''}`} ref={card}>
      <div className="ev-card-top">
        <span className="ev-card-when">{whenLabel(event, localeOf(lang))}</span>
        <h4 className="ev-card-title">{event.title}</h4>
      </div>

      {event.subtitle ? <p className="ev-card-sub">{event.subtitle}</p> : null}

      <div className="ev-card-meta">
        {/*
          * First in the row, ahead of even the on-sale chip, because on a running card it is the
          * question the title left open — `XVII Bieg Ziemi Puckiej` is a name, not a plan. Absent
          * on everything that is not a race, and on the four races in five whose title does not
          * say: see the precision note in `distance.ts`.
          */}
        {event.distancesM?.length ? (
          <span className="ev-chip ev-chip--distance">{formatDistances(event.distancesM)}</span>
        ) : null}
        {event.ticketUrl ? <span className="ev-chip ev-chip--sale">{t.onSaleNow}</span> : null}
        {/*
          * The sale date, where the source stated it ahead of time. Drawn even when a ticket link
          * is already there, because the two say different things: `onSaleNow` means "buy it", and
          * this means "be awake". Without it the card gives no way to check what the reminder that
          * is about to arrive was counting down to.
          */}
        {saleChip ? <span className="ev-chip ev-chip--presale">{saleChip}</span> : null}
        {/*
          * Where it is and who it is for, on every card. Nothing filters on either any more, so
          * this is the classifier's answer read rather than obeyed — and `?` is what says it has
          * not reached this row, which is the only sign in the app that the pass has stopped.
          */}
        <span className="ev-chip ev-chip--place">
          {countryLabel(event.country)} · {reachLabel(event.reach, t)}
        </span>
        {/*
          * Only when the classifier says this row is not a listing, which is the only case the
          * word adds anything to: an article among the listings says it is one, where a chip on
          * every card reading "yes, this is an event" is a label nobody reads twice.
          */}
        {kindLabel(event.kind, t) ? (
          <span className="ev-chip ev-chip--kind">{kindLabel(event.kind, t)}</span>
        ) : null}
        {placeLabel(event) ? <span>{placeLabel(event)}</span> : null}
        <span>{event.sourceName}</span>
        {/*
          * When the *source* published it, where the source said so — and only the collector's own
          * first sighting when it did not.
          *
          * These are different facts and the card was printing the second while implying the
          * first. A news list holds ten items and a feed twenty, so the run that first reaches one
          * is reading a back catalogue: a piece the theatre published in July was met in
          * September and captioned `Announced 2 d ago`, which made two-month-old news the freshest
          * thing on the screen. `firstSeenAt` is still what `announced` notices fire on, and still
          * what this says where nothing else is known.
          */}
        {event.publishedAt !== undefined ? (
          <span>{fill(t.publishedAgo, { when: relativeTime(event.publishedAt, now, t) })}</span>
        ) : (
          <span>{fill(t.announcedAgo, { when: relativeTime(event.firstSeenAt, now, t) })}</span>
        )}
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
