/**
 * The Sources tab: where events come from, what a model adds to them, and which of them you hear.
 *
 * The feed answers "what is on"; this answers "and how would I know if that were wrong". Since the
 * Pipeline tab went (Sep 2026) it is also the whole of that second question — and it is organised
 * per source rather than per corpus, which is the change worth understanding. A tab listing 1,150
 * rows with eight facets over them could tell you the classifier had reached 71% of everything; it
 * could not tell you *this scrape's* rows are the unlabelled ones, and that is the shape every
 * failure in this app has actually had.
 *
 * Four facts are drawn per source, and they are four different questions:
 *
 * - **The pages**, from `SOURCE_CATALOGUE` — the URLs the collector actually requests, as links, so
 *   the claim is checkable rather than just stated. This half is static: it needs no network, no
 *   pull and no collector run, so the tab says something useful on a dead connection and on an
 *   account whose first collection has not happened yet.
 * - **Health**, from `eventSources` — whether the last run got anything.
 * - **How much of the corpus is its** — because a source can be green, be read, and still be
 *   contributing nothing you would miss.
 * - **What a model was asked about its rows, and how much has come back** (`extraction.ts`). Which
 *   pass reads a row is decided by the row's own tags, so this is counted rather than described:
 *   an empty classifier column against a full source is what a stopped pass looks like.
 *
 * There used to be a fifth — the interests reaching each source, read-only, editable in place. It
 * went with the interests themselves (Sep 2026), and so did the question it answered: there is no
 * per-reader filter left to check against a source's rows, so `n collected` and the switch beside
 * it are the whole of what this tab says about what reaches you.
 *
 * And one control, which is the only thing on this tab that writes anything by itself. A pipeline
 * is tuned by running it, and a source that turns out to be noisy cannot be fixed from a phone —
 * so the question this tab answers has an answer you can act on without waiting for a deploy. It
 * is also, since the interests went, the **only** filter in the app: a switched-off source reaches
 * neither the feed nor the lock screen, and everything else a source publishes does both.
 *
 * `sourcePrefs.ts` has what switching one off does and does not do. In short: it is this account's
 * preference, not an instruction to the collector — the page is still fetched, still counted, and
 * still reports its health, so turning it back on costs nothing and loses nothing.
 *
 * Behind the sign-in gate like every other tab.
 */
import { useEffect, useMemo, useState } from 'react';
import { describeError, log } from '../../lib/logger';
import { useAuth } from '../../hooks/useAuth';
import { useEventFeed } from '../../hooks/useEventFeed';
import { useEventSourcePrefs } from '../../hooks/useEventSourcePrefs';
import { pullSourceHealth } from '../../utils/events/browser/cloud';
import { countryLabel } from '../../utils/events/countries';
import { modelPasses, type ModelPass, type PassCoverage } from '../../utils/events/extraction';
import { bySource } from '../../utils/events/feed';
import {
  countriesOf,
  townsOf,
  type CountryOption,
  type TownOption,
} from '../../utils/events/sourcePrefs';
import { SOURCE_CATALOGUE, type SourceKind, type SourcePage } from '../../utils/events/sources';
import type { EventRecord, SourceHealth } from '../../utils/events/types';
import EventsGate from './EventsGate';
import { sourceName, sourceNote } from './sourceNames';
import { fill, relativeTime, translations, type Lang, type Translation } from './translations';

interface Props {
  lang: Lang;
}

/** A source with nothing collected yet: no pass to draw. */
const EMPTY_PASSES: PassCoverage[] = [];

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
  const switches = useEventSourcePrefs(auth.user);
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

  /*
   * The corpus split once, and each source's coverage computed once.
   *
   * Memoised rather than called in the card: `modelPasses` walks a source's rows once per field it
   * counts, and without this it would be redone on every switch flipped.
   */
  const rowsBySource = useMemo(() => bySource(feed.events), [feed.events]);
  const passesBySource = useMemo(() => {
    const out = new Map<string, PassCoverage[]>();
    for (const [id, rows] of rowsBySource) out.set(id, modelPasses(rows));
    return out;
  }, [rowsBySource]);
  const townsBySource = useMemo(() => {
    const out = new Map<string, TownOption[]>();
    for (const [id, rows] of rowsBySource) out.set(id, townsOf(rows));
    return out;
  }, [rowsBySource]);
  const countriesBySource = useMemo(() => {
    const out = new Map<string, CountryOption[]>();
    for (const [id, rows] of rowsBySource) out.set(id, countriesOf(rows));
    return out;
  }, [rowsBySource]);
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
        {/*
          * A switch that did not save has to say so. The local copy is already applied, so the
          * boxes and this browser's feed are right and the other device and the collector are
          * not — which is the one state nothing else on the screen would distinguish from having
          * worked, and it is the state in which the phone keeps ringing.
          */}
        {switches.error ? (
          <p className="ev-error" role="alert">
            {fill(t.sourceSwitchFailed, { error: switches.error })}
          </p>
        ) : null}
      </section>

      <ul className="ev-source-list">
        {SOURCE_CATALOGUE.map((entry) => {
          const row = byId.get(entry.id);
          const failing = (row?.consecutiveFailures ?? 0) > 0;
          const on = switches.enabled(entry.id);
          const rows = rowsBySource.get(entry.id) ?? [];
          return (
            <li
              className={`ev-source${failing ? ' ev-source--bad' : ''}${on ? '' : ' ev-source--off'}`}
              key={entry.id}
            >
              <div className="ev-source-head">
                <h3 className="ev-source-name">{sourceName(entry.id, entry.label, t)}</h3>
                <span className="ev-chip">{kindLabel(entry.kind, t)}</span>
                {entry.needsKey ? (
                  <span className="ev-chip">{fill(t.sourceNeedsKey, { name: entry.needsKey })}</span>
                ) : null}
              </div>

              <p className="ev-source-note">{sourceNote(entry.id, t)}</p>

              {/*
                * The switch, under the sentence describing the source and above the pages it
                * reads — between the two things it is a judgement about.
                *
                * A checkbox and not a styled toggle: this is a setting that stays set, and the
                * one control on this page whose state has to be readable at a glance from across
                * a list of five. The label carries the whole sentence so the tap target is the
                * words as well as the box, which on a phone is the difference between a control
                * and a decoration.
                */}
              <label className="ev-check ev-source-switch">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!switches.ready}
                  onChange={(e) => switches.setEnabled(entry.id, e.target.checked)}
                />
                <span>{on ? t.sourceOn : t.sourceOff}</span>
              </label>

              {on && entry.townPicker ? (
                <TownPicker
                  id={entry.id}
                  towns={townsBySource.get(entry.id) ?? []}
                  total={rows.length}
                  selected={switches.city(entry.id)}
                  disabled={!switches.ready}
                  onChange={(city) => switches.setCity(entry.id, city)}
                  t={t}
                />
              ) : null}

              {on && entry.countryPicker ? (
                <CountryPicker
                  id={entry.id}
                  countries={countriesBySource.get(entry.id) ?? []}
                  total={rows.length}
                  selected={switches.country(entry.id)}
                  disabled={!switches.ready}
                  onChange={(country) => switches.setCountry(entry.id, country)}
                  t={t}
                />
              ) : null}

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
                  * did the collector get anything last time, and how much of what it got is here.
                  * A green source contributing nothing is not a fault and must not read as one.
                  */}
                <span className={failing ? 'ev-status ev-status--bad' : 'ev-status'}>
                  {healthLabel(row, now, t)}
                </span>
                {/*
                  * A chip rather than more grey text after a separator. Spaced apart the two read
                  * as one run-on sentence, and a `·` between them orphans onto the second line at
                  * 320px, where it reads as a bullet.
                  *
                  * Still counted while the source is off, and that is deliberate: it is how much
                  * of the shared corpus this source produced, which is a fact about the collector
                  * rather than about what reaches the reader. Zeroing it would make a silenced
                  * source indistinguishable from a dead one on the very screen where that
                  * difference is the question.
                  */}
                {feed.ready ? (
                  <span className="ev-chip">{fill(t.sourceInCorpus, { count: rows.length })}</span>
                ) : null}
              </p>

              {feed.ready ? (
                <Extraction
                  passes={passesBySource.get(entry.id) ?? EMPTY_PASSES}
                  unclassified={entry.unclassified === true}
                  t={t}
                />
              ) : null}
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

/**
 * Narrow one source to one town.
 *
 * Offered only on a source the catalogue marks `townPicker`, and only once its rows name more than
 * one town — a picker with a single choice is a control that does nothing. A town already
 * chosen is always offered, even when no upcoming row names it any more, so the setting on the
 * screen is never one the select cannot show.
 *
 * Options come from the rows rather than a list of Polish towns: what can be chosen is what this
 * source has actually said, in the spelling it says it in. `sourceAdmits` then compares folded,
 * so `Warszawa` still catches `WARSZAWA` and `Warszawa-Wawer`.
 */
function TownPicker({
  id,
  towns,
  total,
  selected,
  disabled,
  onChange,
  t,
}: {
  id: string;
  towns: TownOption[];
  total: number;
  selected: string | undefined;
  disabled: boolean;
  onChange: (city: string | undefined) => void;
  t: Translation;
}) {
  const options =
    selected && !towns.some((town) => town.city === selected)
      ? [{ city: selected, count: 0 }, ...towns]
      : towns;
  if (options.length < 2 && !selected) return null;
  const inputId = `ev-source-city-${id}`;
  return (
    <div className="ev-field ev-source-city">
      <label className="ev-field-label" htmlFor={inputId}>
        {t.sourceCityLabel}
      </label>
      <select
        id={inputId}
        className="ev-input"
        value={selected ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{fill(t.sourceCityAll, { count: total })}</option>
        {options.map((town) => (
          <option key={town.city} value={town.city}>
            {fill(t.sourceCityOption, { city: town.city, count: town.count })}
          </option>
        ))}
      </select>
      {selected ? <p className="ev-hint">{fill(t.sourceCityOn, { city: selected })}</p> : null}
    </div>
  );
}

/**
 * Narrow one source to one country.
 *
 * The town picker's shape, for a source the catalogue marks `countryPicker`. The options are the
 * codes the rows carry — ISO-2 or `online`, as the card's chip prints them — and a country already
 * chosen is always offered, so the setting on the screen is one the select can show.
 */
function CountryPicker({
  id,
  countries,
  total,
  selected,
  disabled,
  onChange,
  t,
}: {
  id: string;
  countries: CountryOption[];
  total: number;
  selected: string | undefined;
  disabled: boolean;
  onChange: (country: string | undefined) => void;
  t: Translation;
}) {
  const options =
    selected && !countries.some((c) => c.country === selected)
      ? [{ country: selected, count: 0 }, ...countries]
      : countries;
  if (options.length < 2 && !selected) return null;
  const inputId = `ev-source-country-${id}`;
  return (
    <div className="ev-field ev-source-city">
      <label className="ev-field-label" htmlFor={inputId}>
        {t.sourceCountryLabel}
      </label>
      <select
        id={inputId}
        className="ev-input"
        value={selected ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{fill(t.sourceCountryAll, { count: total })}</option>
        {options.map((c) => (
          <option key={c.country} value={c.country}>
            {fill(t.sourceCityOption, { city: countryLabel(c.country), count: c.count })}
          </option>
        ))}
      </select>
      {selected ? (
        <p className="ev-hint">{fill(t.sourceCountryOn, { country: countryLabel(selected) })}</p>
      ) : null}
    </div>
  );
}

/**
 * What a model was asked about this source's rows.
 *
 * A pass with no rows is not drawn — the reader never touches four of the five sources, and an
 * empty heading under each of them would be four sentences about nothing. A pass with rows and no
 * answers *is* drawn, at zero, because that is the state this block exists for.
 */
function Extraction({
  passes,
  unclassified,
  t,
}: {
  passes: PassCoverage[];
  /** The catalogue opts this source out of the classifier, which is a setting, not an empty queue. */
  unclassified: boolean;
  t: Translation;
}) {
  return (
    <section className="ev-source-block">
      <h4 className="ev-block-head">{t.extractionHeading}</h4>
      {unclassified ? <p className="ev-hint">{t.extractionDisabled}</p> : null}
      {passes.length === 0 ? (
        unclassified ? null : <p className="ev-hint">{t.extractionNone}</p>
      ) : (
        passes.map((pass) => <Pass key={pass.pass} pass={pass} t={t} />)
      )}
    </section>
  );
}

function Pass({ pass, t }: { pass: PassCoverage; t: Translation }) {
  // Answered against asked, which is the number the block is for: `0 of 412` is a classifier that
  // has stopped, and it says so without anybody having to count chips.
  const behind = pass.answered < pass.rows;
  return (
    <div className="ev-pass">
      <p className="ev-pass-head">
        <span className="ev-pass-name">{passLabel(pass.pass, t)}</span>
        <span className={`ev-chip${behind ? ' ev-chip--pending' : ''}`}>
          {fill(t.passAnswered, { answered: pass.answered, rows: pass.rows })}
        </span>
      </p>
      <p className="ev-hint">{passNote(pass.pass, t)}</p>
      <ul className="ev-extracted">
        {pass.fields.map((field) => (
          <li className="ev-extracted-item" key={field.field}>
            {/* The stored field name beside the word for it, for the reason a page's link text is
                its URL: the word is what makes it readable and the name is what makes it
                checkable — against a document in the console, or against `types.ts`. */}
            <code className="ev-extracted-name">{field.field}</code>
            <span className="ev-extracted-word">{fieldLabel(field.field, t)}</span>
            <span className="ev-extracted-count">{field.present}</span>
            {field.shared ? <span className="ev-chip">{t.fieldShared}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function kindLabel(kind: SourceKind, t: Translation): string {
  if (kind === 'scrape') return t.kindScrape;
  if (kind === 'ical') return t.kindIcal;
  if (kind === 'rss') return t.kindRss;
  return t.kindApi;
}

function passLabel(pass: ModelPass, t: Translation): string {
  return pass === 'newsroom' ? t.passNewsroom : t.passClassifier;
}

function passNote(pass: ModelPass, t: Translation): string {
  return pass === 'newsroom' ? t.passNewsroomNote : t.passClassifierNote;
}

/**
 * The word for a field a model writes.
 *
 * Exhaustive over the five that reach here, with the stored name as the fallback: a sixth field
 * added to a pass is then a name in a monospaced font rather than a blank, which is wrong but
 * readable — and the `<code>` beside it says the same thing anyway.
 */
function fieldLabel(field: keyof EventRecord | string, t: Translation): string {
  if (field === 'kind') return t.extractKind;
  if (field === 'reach') return t.extractReach;
  if (field === 'country') return t.extractCountry;
  if (field === 'newsroomTicketSale') return t.extractTicketSale;
  if (field === 'onSaleAt') return t.extractSaleAt;
  return String(field);
}

/**
 * What a page stamps on everything it yields, plus whether its absence is normal.
 *
 * Shown because a tag a page stamps feed-wide is a claim about every row behind it, and the three
 * worst bugs this app has had were all a blanket tag being wider than the thing it described. The
 * interests that used to be handed the whole of such a tag are gone; the tag is still what the
 * classifier's prompt and anything reading `EventRecord.tags` sees, and reading it off the page it
 * comes from is what makes the next one catchable.
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
