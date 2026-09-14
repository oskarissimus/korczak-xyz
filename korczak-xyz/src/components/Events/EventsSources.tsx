/**
 * The Sources tab: where events come from, what a model adds to them, and what filters them.
 *
 * The feed answers "what is on"; this answers "and how would I know if that were wrong". Since the
 * Pipeline tab went (Sep 2026) it is also the whole of that second question — and it is organised
 * per source rather than per corpus, which is the change worth understanding. A tab listing 1,150
 * rows with eight facets over them could tell you the classifier had reached 71% of everything; it
 * could not tell you *this scrape's* rows are the unlabelled ones, and that is the shape every
 * failure in this app has actually had.
 *
 * Five facts are drawn per source, and they are five different questions:
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
 *   an empty classifier column against a full source is the single most likely way this app fails
 *   quietly, since an unclassified row *passes* every rule the classifier feeds.
 * - **Which interests reach it, and how much they keep** (`filtering.ts`), read-only, with the same
 *   editor the Interests tab opens. A filter is written once and applied everywhere, but it is
 *   *judged* against one source's rows: a tag no source stamps and an interest that keeps
 *   sixty-seven of a magazine's sixty-eight articles are both invisible from a list of interests.
 *
 * And one control, which is the only thing on this tab that writes anything by itself. A pipeline
 * is tuned by running it, and a source that turns out to be noisy cannot be fixed from a phone —
 * so the question this tab answers now has an answer you can act on without waiting for a deploy.
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
import { useEventInterests } from '../../hooks/useEventInterests';
import { useEventSourcePrefs } from '../../hooks/useEventSourcePrefs';
import { pullSourceHealth } from '../../utils/events/browser/cloud';
import { countryLabel } from '../../utils/events/countries';
import { modelPasses, type ModelPass, type PassCoverage } from '../../utils/events/extraction';
import { bySource, filteringOf, type SourceFiltering } from '../../utils/events/filtering';
import type { InterestDraft } from '../../utils/events/interests';
import { INTERESTS_PATH, localizePath } from '../../utils/events/links';
import { SOURCE_CATALOGUE, type SourceKind, type SourcePage } from '../../utils/events/sources';
import type { EventRecord, SourceHealth } from '../../utils/events/types';
import EventsGate from './EventsGate';
import InterestForm from './InterestForm';
import InterestRules from './InterestRules';
import { sourceName, sourceNote } from './sourceNames';
import { fill, relativeTime, translations, type Lang, type Translation } from './translations';

interface Props {
  lang: Lang;
}

/** A source with nothing collected yet: no pass to draw, and no rows for a filter to keep. */
const EMPTY_PASSES: PassCoverage[] = [];
const NO_ROWS: SourceFiltering = { rows: 0, kept: 0, filters: [], silent: 0 };

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
  const interests = useEventInterests(auth.user);
  const t = translations[lang];
  const now = Date.now();

  const [health, setHealth] = useState<SourceHealth[]>([]);
  const [healthError, setHealthError] = useState<string | null>(null);
  /*
   * Which interest is open in the one form slot, for the whole tab rather than per source.
   *
   * One slot because an interest is not a fact about the source it is drawn under: the same filter
   * appears under every source it reaches, and two open copies of one form would be two drafts of
   * one document, with whichever was saved second winning silently.
   */
  const [editing, setEditing] = useState<string | null>(null);

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
   * The corpus split once, and both summaries computed once per source.
   *
   * Memoised rather than called in the card, and that is not premature: `filteringOf` asks
   * `matchReason` per row per interest, which over two thousand rows and half a dozen interests is
   * ten thousand regex matches — and without this it would be redone on every keystroke in an open
   * interest form and on every switch flipped.
   */
  const rowsBySource = useMemo(() => bySource(feed.events), [feed.events]);
  const passesBySource = useMemo(() => {
    const out = new Map<string, PassCoverage[]>();
    for (const [id, rows] of rowsBySource) out.set(id, modelPasses(rows));
    return out;
  }, [rowsBySource]);
  const filteringBySource = useMemo(() => {
    const out = new Map<string, SourceFiltering>();
    for (const [id, rows] of rowsBySource) out.set(id, filteringOf(rows, interests.interests));
    return out;
  }, [rowsBySource, interests.interests]);
  const byId = useMemo(() => new Map(health.map((row) => [row.id, row])), [health]);

  const save = (id: string, draft: InterestDraft) => {
    interests.updateInterest(id, draft);
    setEditing(null);
  };

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
                <Extraction passes={passesBySource.get(entry.id) ?? EMPTY_PASSES} t={t} />
              ) : null}

              {feed.ready && interests.ready ? (
                <Filtering
                  filtering={filteringBySource.get(entry.id) ?? NO_ROWS}
                  lang={lang}
                  editing={editing}
                  onEdit={setEditing}
                  onSave={save}
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
 * What a model was asked about this source's rows.
 *
 * A pass with no rows is not drawn — the reader never touches four of the five sources, and an
 * empty heading under each of them would be four sentences about nothing. A pass with rows and no
 * answers *is* drawn, at zero, because that is the state this block exists for.
 */
function Extraction({ passes, t }: { passes: PassCoverage[]; t: Translation }) {
  return (
    <section className="ev-source-block">
      <h4 className="ev-block-head">{t.extractionHeading}</h4>
      {passes.length === 0 ? (
        <p className="ev-hint">{t.extractionNone}</p>
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

/**
 * The interests that reach this source, and what they keep of it.
 *
 * Read mode by default and editable in place: the question "is this filter doing what I meant?" is
 * asked here, beside the rows it is being asked about, and an answer that means opening another tab
 * is one nobody acts on. Saving goes through `useEventInterests` exactly as the Interests tab does,
 * so there is one writer and one sync queue.
 *
 * Only the interests that keep something are listed — the rest are a count. Every interest under
 * every source is five copies of one list, and the useful reading of a zero is not per source
 * anyway: an interest matching nothing *anywhere* is a dead interest, which is the Interests tab's
 * question, and the link goes there.
 */
function Filtering({
  filtering,
  lang,
  editing,
  onEdit,
  onSave,
}: {
  filtering: SourceFiltering;
  lang: Lang;
  editing: string | null;
  onEdit: (id: string | null) => void;
  onSave: (id: string, draft: InterestDraft) => void;
}) {
  const t = translations[lang];
  return (
    <section className="ev-source-block">
      <h4 className="ev-block-head">{t.filtersHeading}</h4>
      <p className="ev-hint">
        {fill(t.filtersKept, { kept: filtering.kept, rows: filtering.rows })}
      </p>

      {filtering.filters.length === 0 ? (
        <p className="ev-hint">{t.filtersNone}</p>
      ) : (
        <ul className="ev-filters">
          {filtering.filters.map(({ interest, kept }) => (
            <li className="ev-filter" key={interest.id}>
              <div className="ev-interest-head">
                <h5 className="ev-interest-name">{interest.label}</h5>
                <span className="ev-chip">{fill(t.filterKeeps, { count: kept })}</span>
                <div className="ev-actions">
                  <button
                    type="button"
                    className="ev-link"
                    aria-expanded={editing === interest.id}
                    onClick={() => onEdit(editing === interest.id ? null : interest.id)}
                  >
                    {editing === interest.id ? t.cancel : t.editInterest}
                  </button>
                </div>
              </div>

              {editing === interest.id ? (
                <InterestForm
                  lang={lang}
                  existing={interest}
                  onSubmit={(draft) => onSave(interest.id, draft)}
                  onCancel={() => onEdit(null)}
                />
              ) : (
                <InterestRules interest={interest} lang={lang} />
              )}
            </li>
          ))}
        </ul>
      )}

      {filtering.silent > 0 ? (
        <p className="ev-hint">
          {fill(t.filtersSilent, { count: filtering.silent })}{' '}
          <a className="ev-link" href={localizePath(INTERESTS_PATH, lang)}>
            {t.filtersAll}
          </a>
        </p>
      ) : null}
    </section>
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
