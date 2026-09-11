/**
 * The Feed tab: what is coming up that matches an interest.
 *
 * Also where the push subscription is re-verified. That is deliberate and not just convenience:
 * iOS drops subscriptions silently after a few weeks and has no `pushsubscriptionchange`, so the
 * only defence is checking on launch — and this is the tab the icon opens. Hanging that check off
 * the Alerts tab alone would mean it never runs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useEventFeed } from '../../hooks/useEventFeed';
import { useEventIgnores } from '../../hooks/useEventIgnores';
import { useEventInterests } from '../../hooks/useEventInterests';
import { useWebPush } from '../../hooks/useWebPush';
import {
  buildFeed,
  cityOptions,
  classificationCoverage,
  countryTally,
  kindOptions,
  KIND_KEYS,
  narrowSections,
  placeLabel,
  saleWhenLabel,
  whenLabel,
  type CityOption,
  type FeedGroup,
  type FeedItem,
  type FeedMode,
  type FeedSection,
  type KindKey,
} from '../../utils/events/feed';
import { countryLabel } from '../../utils/events/countries';
import { eventFocusOf, FEED_PATH, localizePath } from '../../utils/events/links';
import { formatDistances } from '../../utils/events/distance';
import { cityKey } from '../../utils/events/cities';
import {
  loadFeedCity,
  loadFeedKinds,
  saveFeedCity,
  saveFeedKinds,
} from '../../utils/events/browser/storage';
import type { EventKind, Reach } from '../../utils/events/types';
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
  const ignores = useEventIgnores(auth.user);
  const t = translations[lang];
  /*
   * The event a notification asked for, read on the very first render rather than in an effect.
   *
   * It decides the view and the three filters below, so reading it a frame later would be the app
   * opening on the ordinary feed and then rearranging itself under the reader's thumb. A `useState`
   * initialiser rather than a plain call, so the answer is fixed for the life of the island: the
   * one thing worse than the wrong view is one that changes its mind halfway through a visit.
   */
  const [focus] = useState<string | null>(focusFromUrl);
  /*
   * `all` when a notification sent us here, and not the tab's usual `matched`.
   *
   * The tap is an instruction to show one specific row, so it has to land in the one view that can
   * show any row: an interest edited since the push was sent, or an Ignore pressed on the card
   * afterwards, would otherwise answer the tap with a feed that does not contain the thing the
   * banner named — which is indistinguishable from the app having lost it.
   */
  const [mode, setMode] = useState<FeedMode>(focus ? 'all' : 'matched');
  /*
   * The city, held as the spelling that was chosen and compared through `cityKey` — one value, so
   * the label on the picker and the key it filters with cannot drift apart, and a `Warsaw` stored
   * by an older build still selects the option now labelled `Warszawa`. Read from localStorage on
   * the first render rather than in an effect: this hides rows, and a frame of the unfiltered feed
   * before it applied would be the app appearing to forget the setting every time it opens.
   */
  const [city, setCity] = useState<string>(() => (focus ? '' : loadFeedCity()));
  const selectedCity = cityKey(city);

  const chooseCity = (next: string) => {
    setCity(next);
    saveFeedCity(next);
  };

  /*
   * The label filter: what the classifier called the row. A word the card already draws as a chip,
   * and a chip you can read and not act on is half a feature.
   *
   * Neither this nor the city above reads its stored value on a visit from a notification, for the
   * same reason the view opens on `all`: a label or a city chosen weeks ago can hide the one row
   * the tap was about, and a highlighted card nobody can see is the bug this was meant to fix
   * wearing a fix. Nothing is written back — the choices are still in localStorage, the note above
   * the list says they are off for this visit, and the link beside it loads the feed without the
   * query, which is what brings them back.
   */
  const kindFilter = useKeyFilter<KindKey>(focus ? () => [] : loadFeedKinds, saveFeedKinds);
  const chosenKinds = kindFilter.chosen;
  const narrowedByLabel = chosenKinds.size > 0;

  // Re-arm silently. Nothing is rendered for it here — the Alerts tab is where push has a UI.
  useWebPush(auth.user, lang, { verifyOnly: true });

  const now = Date.now();
  const ignored = ignores.fingerprints;
  const built = useMemo(
    () => buildFeed(feed.events, interests, now, { mode, ignored }),
    // `now` is deliberately not a dependency: re-grouping on every render would rebuild the list
    // for a clock tick nobody can see. It is recomputed when the data actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed.events, interests, mode, ignored],
  );

  /*
   * Each control's options are built from the feed with the *other* filter applied, so its counts
   * say what pressing a choice would show rather than what the current choice left. That is what
   * these two half-narrowed views are for: `Warszawa (12)` under a kind filter has to mean twelve
   * of the kind being shown, or pressing it lands on a smaller number than it promised.
   *
   * A selection the corpus no longer holds is kept in whichever control holds it — see
   * `withSelected` and `withSelectedKeys`.
   */
  const forCity = useMemo(
    () => narrowSections(built, { kinds: chosenKinds }),
    [built, chosenKinds],
  );
  const forKinds = useMemo(
    () => narrowSections(built, { city: selectedCity }),
    [built, selectedCity],
  );
  const sections = useMemo(
    () => narrowSections(built, { city: selectedCity, kinds: chosenKinds }),
    [built, selectedCity, chosenKinds],
  );

  const cities = useMemo(() => withSelected(cityOptions(eventsOf(forCity)), city), [forCity, city]);
  const kindChoices = useMemo(
    () => withSelectedKeys(kindOptions(eventsOf(forKinds)), chosenKinds, KIND_KEYS),
    [forKinds, chosenKinds],
  );
  /*
   * How many dismissed events there are to go back to — which is a second pass over the corpus and
   * not a `filter` on the ignore list, deliberately. An ignore outlives the event: a concert that
   * has been and gone leaves its row behind forever, and counting those would offer a view holding
   * nothing. Asking `buildFeed` means the number and the list it opens are the same question asked
   * twice, so they cannot disagree about what "an ignored event" is.
   */
  const ignoredCount = useMemo(
    () =>
      narrowSections(buildFeed(feed.events, interests, now, { mode: 'ignored', ignored }), {
        city: selectedCity,
        kinds: chosenKinds,
      }).reduce((total, section) => total + section.items.length, 0),
    // Every filter is a dependency: the button's number and the list it opens are the same
    // question, and a count taken over rows any of them hides would offer a view that opens on
    // nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed.events, interests, ignored, selectedCity, chosenKinds],
  );

  if (!feed.ready || !ready || !ignores.ready) return <div className="ev-loading" />;

  // The picker's own spelling of the chosen city, so the empty-state sentence and the control
  // agree — the stored value may be an exonym the corpus does not use.
  const cityName = cities.find((option) => option.key === selectedCity)?.label ?? city;
  const items = sections.flatMap((section) => section.items);
  const shown = items.length;
  /*
   * Whether the row a notification pointed at is on the screen — by fingerprint, which is what the
   * link carries and what survives the dedupe, so the card the reader sees answers to it however
   * the two copies of one night were resolved.
   */
  const focusShown = focus !== null && items.some((item) => item.event.fingerprint === focus);
  /*
   * Said only once the network has answered, or failed to. A feed restored from the localStorage
   * cache is a few hours old and routinely lacks the very row the push was about, so announcing it
   * missing on the first frame would be wrong about half the taps and would correct itself a
   * second later — which reads as the app changing its mind.
   */
  const focusMissing = focus !== null && !focusShown && (feed.fresh || feed.error !== null);
  // What `Anywhere` would show, which is the rest of the toolbar's narrowing minus the city — not
  // the whole corpus. A count larger than the feed the label filters already limit would be
  // promising rows that clearing the city cannot bring back.
  const inAnyCity = forCity.reduce((total, section) => total + section.items.length, 0);
  const rejecting = mode === 'rejected';
  const ignoring = mode === 'ignored';
  const coverage = classificationCoverage(feed.events);
  // The two filters this view verifies, counted apart: they are answered by the same model call
  // and they are not the same question, and one number over both would hide either going wrong.
  const placeRows = items.filter((item) => item.rejectedFor === 'places');
  const kindRows = items.filter((item) => item.rejectedFor === 'kind');

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
                ['rejected', t.viewRejected],
                ['all', t.viewAll],
                /*
                 * The fourth button appears only once there is something behind it, and it carries
                 * the count so it says so. A permanent `Ignored (0)` would be a control for a
                 * feature most visits never use, and it cannot strand anything: the only way to
                 * reach one is to press Ignore, which puts the button on screen in the same render.
                 *
                 * `|| ignoring` is what keeps it there while you are standing on it. Bringing the
                 * last one back from inside this view takes the count to zero, and without that
                 * clause the button under your finger vanishes mid-tap — leaving an empty list with
                 * none of the three remaining views pressed, which is the state `.ev-view--on`
                 * exists to make impossible.
                 */
                ...(ignoredCount > 0 || ignoring
                  ? [['ignored', fill(t.viewIgnored, { count: ignoredCount })]]
                  : []),
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
          {/*
            * A picker rather than a row of buttons, because the number of cities is whatever the
            * sources happen to list — twenty-odd once Ticketmaster is on — and it is drawn only
            * when there is a choice to make. `Anywhere` carries its own count so the two numbers
            * can be compared: it is larger than the sum of the cities by however many rows no
            * source placed, which is the only way that difference is visible.
            */}
          {cities.length > 0 ? (
            <label className="ev-city">
              <span className="ev-city-label">{t.cityFilter}</span>
              <select
                className="ev-city-select"
                value={selectedCity}
                onChange={(e) =>
                  chooseCity(cities.find((c) => c.key === e.target.value)?.label ?? '')
                }
              >
                <option value="">{fill(t.cityAnywhere, { count: inAnyCity })}</option>
                {cities.map((option) => (
                  <option key={option.key} value={option.key}>
                    {fill(t.cityOption, { city: option.label, count: option.count })}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {/*
            * The two label filters, as buttons rather than a `<select multiple>`.
            *
            * A multiple-select is the wrong control on a phone — iOS draws it as a list nobody can
            * tell is multi-select, and choosing two means knowing to hold a modifier that a touch
            * screen does not have. There are five options at most in either row, so toggles fit,
            * say how many each holds, and show the whole state at a glance. `aria-pressed` rather
            * than a checkbox for the reason the view picker uses it: the pressed button is the
            * answer, and these live in the same toolbar.
            */}
          <FilterChips
            label={t.kindFilter}
            options={kindChoices}
            chosen={chosenKinds}
            labelOf={(key) => kindOptionLabel(key, t)}
            onToggle={kindFilter.toggle}
          />
          {feed.error ? <span className="ev-sync ev-sync--bad">✕ {feed.error}</span> : null}
        </div>

        {/*
          * Why this visit does not look like the last one. Without it a feed with every filter off
          * and one card outlined is three unexplained changes at once, and the way back to the
          * ordinary feed is a link rather than a button because that is exactly what it is: the
          * same page without the query, which restores the stored filters by reloading them.
          */}
        {focusShown || focusMissing ? (
          <p className="ev-note ev-focus-note">
            {focusShown ? t.focusIntro : t.focusMissing}{' '}
            <a className="ev-link" href={localizePath(FEED_PATH, lang)}>
              {t.focusClear}
            </a>
          </p>
        ) : null}

        {ignoring ? <p className="ev-hint">{t.ignoredIntro}</p> : null}

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
            {placeRows.length > 0 ? (
              <p className="ev-tally">
                <span className="ev-tally-head">{t.placesTally}</span>{' '}
                {countryTally(placeRows.map((i) => i.event))
                  .map(({ code, count }) => `${countryLabel(code)} ${count}`)
                  .join(' · ')}
              </p>
            ) : null}
            {/*
              * The other filter's shape, and a plain count is the whole of it: only one of the
              * three kinds is ever removed, so there is nothing to break down the way the
              * countries are. It is on its own line because it is a different filter — folded into
              * the tally above, a row removed for being a press release would read as a country
              * getting it wrong.
              */}
            {kindRows.length > 0 ? (
              <p className="ev-tally">{fill(t.kindTally, { count: kindRows.length })}</p>
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
          <p>{emptyHeading(mode, t)}</p>
          {/*
            * With a city selected, the reason the list is empty is almost always the city and not
            * the interests — so the hint says which one, and the way out is a button rather than a
            * sentence telling you where to find one. A persisted filter with no visible cause is
            * how an app comes to look broken weeks after the choice was made.
            */}
          <p className="ev-hint">
            {narrowedHint(selectedCity ? cityName : '', narrowedByLabel, mode, t)}
          </p>
          {/*
            * A way out for every filter that is on. Only one of them can be named in the sentence
            * above, so the buttons are what say which narrowings are in force — with one missing,
            * clearing the city on a list that a label filter is also emptying would look like the
            * app refusing to show anything.
            */}
          {selectedCity ? (
            <button className="ev-link" type="button" onClick={() => chooseCity('')}>
              {t.cityClear}
            </button>
          ) : null}
          {chosenKinds.size > 0 ? (
            <button className="ev-link" type="button" onClick={kindFilter.clear}>
              {t.kindClear}
            </button>
          ) : null}
        </div>
      ) : (
        sections.map((section) => (
          <section className="ev-group" key={section.group}>
            <h3 className="ev-group-head">{groupLabel(section.group, t)}</h3>
            <ul className="ev-list">
              {section.items.map((item) => (
                <EventCard
                  key={item.event.id}
                  item={item}
                  lang={lang}
                  now={now}
                  focused={item.event.fingerprint === focus}
                  onIgnore={() => ignores.ignore(item.event)}
                  onUnignore={() => ignores.unignore(item.event.fingerprint)}
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
 * Absent is its own case and says so rather than printing nothing: a blank where a label goes and
 * a label that has not arrived yet look identical, and only one of them is a reason for an event
 * to still be in the feed.
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

/**
 * The picker's options, with the chosen city in them whether or not it is still in the corpus.
 *
 * A selection missing from the list is the one state a `<select>` cannot draw: it falls back to the
 * first option, so the control would read `Anywhere` while the feed went on showing one city. That
 * happens for ordinary reasons — a season ends, a scrape has a bad run, the account changes — and
 * it would look exactly like the filter being stuck. Kept with its count of zero, it says the true
 * thing instead: this is on, and there is nothing behind it.
 */
function withSelected(options: CityOption[], city: string): CityOption[] {
  const key = cityKey(city);
  if (!key || options.some((option) => option.key === key)) return options;
  return [...options, { key, label: city, count: 0 }].sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

/**
 * One multi-select filter's state, persisted as it changes.
 *
 * Shared by the two label rows because they are the same control over different fields, and a
 * second copy of "toggle, store, and read back on the first render" is the sort of duplication
 * that stays in step until the day one of them gains a rule.
 *
 * The list is the state and the set is derived, rather than the other way round: the list is what
 * goes to JSON, so one shape is stored and the two cannot come to disagree about what is chosen.
 * Read from localStorage in the initialiser for the reason the city is — this hides rows, and a
 * frame of the unfiltered feed before it applied is the app appearing to forget the setting every
 * time it opens.
 */
function useKeyFilter<K extends string>(load: () => K[], save: (keys: K[]) => void) {
  const [keys, setKeys] = useState<K[]>(load);
  const chosen = useMemo(() => new Set(keys), [keys]);

  const toggle = (key: K) => {
    const next = chosen.has(key) ? keys.filter((k) => k !== key) : [...keys, key];
    setKeys(next);
    save(next);
  };

  const clear = () => {
    setKeys([]);
    save([]);
  };

  return { chosen, toggle, clear };
}

/**
 * A row of toggles for one field, or nothing when there is no choice to make.
 *
 * One option is not a filter — pressing it can only empty the screen — so the row waits until the
 * corpus holds two. It is never taken away while something is chosen, though: the way back out of
 * a narrowing has to outlive the corpus that offered it.
 */
function FilterChips<K extends string>({
  label,
  options,
  chosen,
  labelOf,
  onToggle,
}: {
  label: string;
  options: Array<{ key: K; count: number }>;
  chosen: ReadonlySet<K>;
  labelOf: (key: K) => string;
  onToggle: (key: K) => void;
}) {
  if (options.length < 2 && chosen.size === 0) return null;
  return (
    <div className="ev-kinds" role="group" aria-label={label}>
      {/* The group carries the name; the visible copy of it would be announced twice. */}
      <span className="ev-kinds-label" aria-hidden="true">
        {label}
      </span>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`ev-kind${chosen.has(option.key) ? ' ev-kind--on' : ''}`}
          aria-pressed={chosen.has(option.key)}
          onClick={() => onToggle(option.key)}
        >
          {`${labelOf(option.key)} (${option.count})`}
        </button>
      ))}
    </div>
  );
}

/** The events behind a set of sections, which is what every option list is counted over. */
function eventsOf(sections: FeedSection[]) {
  return sections.flatMap((section) => section.items).map((item) => item.event);
}

/**
 * A picker's options with the chosen keys in them, whatever the corpus currently holds.
 *
 * `withSelected`'s argument, reaching the two label filters: a kind chosen on a day the theatre had
 * announced something and gone to zero since would otherwise take its own button off the screen,
 * leaving a feed narrowed to nothing with no control saying so and nothing to press to undo it.
 * Kept at zero, the row says the true thing: this is on, and there is nothing behind it.
 */
function withSelectedKeys<K extends string>(
  options: Array<{ key: K; count: number }>,
  chosen: ReadonlySet<K>,
  order: readonly K[],
): Array<{ key: K; count: number }> {
  const missing = [...chosen].filter((key) => !options.some((option) => option.key === key));
  if (missing.length === 0) return options;
  return [...options, ...missing.map((key) => ({ key, count: 0 }))].sort(
    (a, b) => order.indexOf(a.key) - order.indexOf(b.key),
  );
}

/**
 * The word on a kind's filter button — plural, and there is one for `listing` where the card has
 * none.
 *
 * The card deliberately draws no chip for a listing (a label on every row saying "yes, this is an
 * event" is one nobody reads twice) but a filter that offered every kind except the commonest
 * would be a filter you cannot use to see only events. Same for `unlabelled`: the absence of a
 * verdict is a thing to be able to look at, which is the whole of how a stalled classifier gets
 * noticed from this tab.
 */
function kindOptionLabel(key: KindKey, t: Translation): string {
  if (key === 'announcement') return t.kindsAnnouncements;
  if (key === 'coverage') return t.kindsCoverage;
  if (key === 'unlabelled') return t.kindsUnlabelled;
  return t.kindsListings;
}

/**
 * What an empty list says, naming the narrowing that most likely caused it.
 *
 * The city first when several are on: it is the filter that hides most, and the buttons under this
 * sentence say what else is in force. A persisted filter with no visible cause is how an app comes
 * to look broken weeks after the choice was made.
 */
function narrowedHint(
  city: string,
  narrowedByLabel: boolean,
  mode: FeedMode,
  t: Translation,
): string {
  if (city) return fill(t.cityEmptyHint, { city });
  if (narrowedByLabel) return t.labelEmptyHint;
  return emptyHint(mode, t);
}

/**
 * What an empty list says.
 *
 * By mode rather than by a `rejecting ? … : …` pair, which was already one ternary short of
 * readable at three views. Each of the four is a different sentence because an empty list means a
 * different thing in each: no matches, nothing removed by place, nothing dismissed, or a corpus
 * with nothing upcoming in it at all.
 */
function emptyHeading(mode: FeedMode, t: Translation): string {
  if (mode === 'rejected') return t.rejectedEmpty;
  if (mode === 'ignored') return t.ignoredEmpty;
  return t.feedEmpty;
}

function emptyHint(mode: FeedMode, t: Translation): string {
  if (mode === 'rejected') return t.rejectedEmptyHint;
  if (mode === 'ignored') return t.ignoredEmptyHint;
  return t.feedEmptyHint;
}

function groupLabel(group: FeedGroup, t: Translation): string {
  if (group === 'week') return t.groupThisWeek;
  if (group === 'month') return t.groupThisMonth;
  if (group === 'later') return t.groupLater;
  return t.groupUndated;
}

function EventCard({
  item,
  lang,
  now,
  focused = false,
  onIgnore,
  onUnignore,
}: {
  item: FeedItem;
  lang: Lang;
  now: number;
  /** The row a notification was about: outlined, and scrolled to once. */
  focused?: boolean;
  onIgnore: () => void;
  onUnignore: () => void;
}) {
  const t = translations[lang];
  const { event } = item;
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
        {/*
          * Only when the classifier says this row is not a listing, which is the only case the
          * word adds anything to. It is drawn in every view rather than only the rejected one, for
          * the reason above it: an article kept by an interest that asked for articles and one
          * nobody has judged yet are different rows, and this is what tells them apart.
          */}
        {kindLabel(event.kind, t) ? (
          <span className="ev-chip ev-chip--kind">{kindLabel(event.kind, t)}</span>
        ) : null}
        {/*
          * Only `all` and `ignored` can draw a dismissed row, and in `all` the chip is the whole
          * difference between the two views: without it, a card present in Everything and absent
          * from Matched looks like the matcher disagreeing with itself.
          */}
        {item.ignored ? <span className="ev-chip ev-chip--ignored">{t.ignoredChip}</span> : null}
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

      {/*
        * The model's own sentence, so a verdict can be argued with rather than only obeyed — the
        * one for the rule that actually turned the row away. There are two sentences on a
        * classified record and they answer different questions; printing the geography reasoning
        * under a row removed for being a press release would look like the wrong filter fired.
        */}
      {item.rejectedBy?.length ? (
        <p className="ev-reason">
          {item.rejectedFor === 'kind' ? event.kindReason : event.reachReason}
        </p>
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
        {/*
          * Last in the row, after the two links, because it is the destructive one and the row is
          * scanned left to right for the thing you came to the card to do. No confirmation: it is
          * one tap to undo from the Ignored view, and a dialog per dismissal would cost more than
          * the mistake does.
          */}
        <button className="ev-link" type="button" onClick={item.ignored ? onUnignore : onIgnore}>
          {item.ignored ? t.unignoreEvent : t.ignoreEvent}
        </button>
      </div>
    </li>
  );
}


