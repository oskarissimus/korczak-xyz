/**
 * The Pipeline tab: the corpus as it is stored, and which pass of the collector wrote each half.
 *
 * The other four tabs are about events. This one is about the *extraction* — scrape, derive,
 * classify, present — and it exists because until now the only way to tell a scrape that read a
 * page badly from a classifier that judged it wrongly was to open the Firestore console. A card in
 * the feed is the end of that pipeline with every intermediate fact thrown away: no haystack, no
 * fingerprint, no hashes, and no reason for a row that is missing.
 *
 * Three things it does that no other tab does, and each answers a different question:
 *
 * - **It lists the whole corpus**, past rows included and interests ignored. "Is this event in the
 *   feed" and "did the collector get this event" are different questions, and only the second one
 *   can tell you whether a scrape is working.
 * - **Every field with a vocabulary at all has a multi-select over it** — see `pipeline.ts`. The
 *   counts are the report: `publishedAt (312)` against 1,150 rows is the state of that extraction
 *   in one number, and `Kind — not set (400)` is the classifier's queue.
 * - **A row opens into its own JSON**, grouped by the pass that wrote it, so a wrong value can be
 *   traced to the step that produced it rather than guessed at.
 *
 * Behind the sign-in gate like every other tab: it reads the same shared corpus, under the same
 * rules.
 */
import { useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useEventCorpus } from '../../hooks/useEventCorpus';
import { countryLabel } from '../../utils/events/countries';
import {
  ABSENT,
  applyFacets,
  chosenCount,
  facetsOf,
  NO_FACETS,
  stageBlocks,
  toggleFacet,
  type Facet,
  type FacetKey,
  type FacetSelection,
  type PipelineStage,
} from '../../utils/events/pipeline';
import { tokenizeJson } from '../../utils/jsonView';
import type { EventRecord } from '../../utils/events/types';
import EventsGate from './EventsGate';
import { sourceName } from './sourceNames';
import { fill, translations, type Lang, type Translation } from './translations';

interface Props {
  lang: Lang;
}

/**
 * How many rows are drawn before the list stops and says so.
 *
 * The pull is up to two thousand documents and every one of them is a row with a line of chips;
 * drawn at once that is a tab which takes a second to arrive on a phone, for a list nobody scrolls
 * to the end of. The button below it is what keeps a deep row reachable without making the filters
 * the only way to see anything.
 */
const PAGE = 150;

/** One shared empty set, so an unchosen axis does not mint a new one on every render. */
const EMPTY: ReadonlySet<string> = new Set();

export default function EventsPipeline({ lang }: Props) {
  const auth = useAuth();
  return (
    <EventsGate auth={auth} lang={lang} path="/pipeline/">
      <PipelinePanel lang={lang} />
    </EventsGate>
  );
}

function PipelinePanel({ lang }: Props) {
  const auth = useAuth();
  const corpus = useEventCorpus(auth.user);
  const t = translations[lang];

  /*
   * The chosen filters, and they are deliberately **not persisted**, unlike the Feed's three.
   *
   * Those hide rows from a list somebody reads every day, so forgetting them would be the app
   * losing a setting. Here the tab is opened to answer one question and the next visit is a
   * different question. A stored narrowing would mean coming back weeks later to a corpus that
   * looks empty, on the one screen whose job is telling you whether the corpus is empty.
   */
  const [selection, setSelection] = useState<FacetSelection>(NO_FACETS);
  const [cap, setCap] = useState(PAGE);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const choose = (key: FacetKey, value: string) => {
    setSelection((current) => toggleFacet(current, key, value));
    // Back to the first page: the cap is a position in a list, and the list has just changed.
    setCap(PAGE);
  };

  const clearAll = () => {
    setSelection(NO_FACETS);
    setCap(PAGE);
  };

  const toggleRow = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const facets = useMemo(() => facetsOf(corpus.events, selection), [corpus.events, selection]);
  const rows = useMemo(() => applyFacets(corpus.events, selection), [corpus.events, selection]);

  if (!corpus.ready) return <div className="ev-loading" />;

  const shown = rows.slice(0, cap);
  const narrowed = chosenCount(selection) > 0;

  return (
    <div className="ev-pipeline">
      <section className="ev-section">
        <h2 className="ev-subhead">{t.pipelineHeading}</h2>
        <p className="ev-hint">{t.pipelineIntro}</p>
        {/*
         * Not cached, and it says so rather than drawing an empty list over a failed pull: on this
         * tab an empty corpus and an unreachable one are the same picture, and only one of them is
         * a reason to go and look at the collector.
         */}
        {corpus.error ? (
          <p className="ev-error" role="alert">
            {corpus.error} — {t.pipelineOffline}{' '}
            <button className="ev-link" type="button" onClick={corpus.refresh}>
              {t.pipelineRetry}
            </button>
          </p>
        ) : null}

        <div className="ev-toolbar">
          <span>{fill(t.pipelineShowing, { shown: rows.length, total: corpus.events.length })}</span>
          {/*
           * One way out for every axis at once. The Feed grew a button per filter because it has
           * three; here there are eight, and eight "show everything" buttons would be more control
           * than corpus. It sits outside the disclosure below, with the count, so a narrowing is
           * never hidden behind a closed panel.
           */}
          {narrowed ? (
            <button className="ev-link" type="button" onClick={clearAll}>
              {t.pipelineClearAll}
            </button>
          ) : null}
          {/*
           * Eight axes over a real corpus is twenty-odd cities and every tag any source applies,
           * which at 320px is several screens of buttons before the first row. Open by default,
           * because the counts are half of what this tab is for and a filter panel you have to
           * find is one nobody presses — but a real disclosure, so a phone can put the wall away.
           *
           * The summary carries how many filters are on, for the reason the Feed's empty-state
           * buttons exist: a narrowing with nothing on screen saying who asked for it is how an
           * app comes to look broken.
           */}
          <details className="ev-facets" open>
            <summary className="ev-facets-summary">
              {narrowed
                ? `${t.pipelineFilters} — ${fill(t.pipelineFiltersOn, {
                    count: chosenCount(selection),
                  })}`
                : t.pipelineFilters}
            </summary>
            {facets.map((facet) => (
              <FacetRow
                key={facet.key}
                facet={facet}
                chosen={selection.get(facet.key) ?? EMPTY}
                t={t}
                onToggle={(value) => choose(facet.key, value)}
              />
            ))}
          </details>
        </div>
      </section>

      {shown.length === 0 ? (
        <div className="ev-empty">
          <p>{t.pipelineEmpty}</p>
          <p className="ev-hint">{t.pipelineEmptyHint}</p>
          {narrowed ? (
            <button className="ev-link" type="button" onClick={clearAll}>
              {t.pipelineClearAll}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="ev-pipe-list">
            {shown.map((event) => (
              <PipelineRow
                key={event.id}
                event={event}
                open={open.has(event.id)}
                onToggle={() => toggleRow(event.id)}
                t={t}
              />
            ))}
          </ul>
          {rows.length > shown.length ? (
            <p className="ev-pipe-more">
              {fill(t.pipelineCapped, { shown: shown.length, matching: rows.length })}{' '}
              <button className="ev-link" type="button" onClick={() => setCap(cap + PAGE)}>
                +{PAGE}
              </button>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * One axis, as a row of toggles — the Feed toolbar's control, over eight fields instead of two.
 *
 * Drawn even at one option, unlike the Feed's `FilterChips`. There the row is a filter and one
 * option cannot narrow anything; here the count beside the only value is the answer to "what does
 * this corpus hold on this axis", which is most of what the tab is for. An axis with nothing at all
 * on it is the one that is left out.
 */
function FacetRow({
  facet,
  chosen,
  t,
  onToggle,
}: {
  facet: Facet;
  chosen: ReadonlySet<string>;
  t: Translation;
  onToggle: (value: string) => void;
}) {
  if (facet.options.length === 0) return null;
  const label = facetLabel(facet.key, t);

  return (
    <div className="ev-kinds" role="group" aria-label={label}>
      {/* The group carries the name; a visible copy of it would be announced twice. */}
      <span className="ev-kinds-label" aria-hidden="true">
        {label}
      </span>
      {facet.options.map((option) => (
        <button
          key={option.value || 'absent'}
          type="button"
          className={`ev-kind${chosen.has(option.value) ? ' ev-kind--on' : ''}${
            option.value === ABSENT ? ' ev-kind--absent' : ''
          }`}
          aria-pressed={chosen.has(option.value)}
          onClick={() => onToggle(option.value)}
        >
          {`${optionLabel(facet.key, option.value, option.label, t)} (${option.count})`}
        </button>
      ))}
    </div>
  );
}

/**
 * One stored row, and — when it is opened — its fields grouped by the pass that wrote them.
 *
 * The head is deliberately not the feed's card: no relative time, no "matched by", no sale chips.
 * What identifies a row here is its **id**, which is derived from the source and the source's own
 * key, is what every other collection in this app joins back to, and is printed on no other tab.
 */
function PipelineRow({
  event,
  open,
  onToggle,
  t,
}: {
  event: EventRecord;
  open: boolean;
  onToggle: () => void;
  t: Translation;
}) {
  return (
    <li className="ev-pipe-row">
      <div className="ev-pipe-head">
        {/* The stored day rather than a formatted date: this view shows what is in the field. */}
        <span className="ev-pipe-day">{event.day ?? '—'}</span>
        <h4 className="ev-pipe-title">{event.title}</h4>
      </div>

      <p className="ev-pipe-id">{event.id}</p>

      <div className="ev-card-meta">
        <span>{sourceName(event.source, event.sourceName, t)}</span>
        <span className="ev-chip ev-chip--place">
          {countryLabel(event.country)} · {reachWordOf(event.reach ?? '', t)}
        </span>
        {/*
         * The kind and the reach are drawn on *every* row here, including the ones the feed leaves
         * bare. The feed is right to draw no chip saying "yes, this is an event" — it would be a
         * label on every card that nobody reads twice — but this is a table of what is stored, and
         * a blank where a verdict goes is exactly what is being looked for.
         */}
        <span className="ev-chip ev-chip--kind">{kindWordOf(event.kind ?? '', t)}</span>
        {event.newsroomKind ? (
          <span className="ev-chip ev-chip--newsroom">{newsroomWord(event.newsroomKind, t)}</span>
        ) : null}
        {/*
         * Every tag, as it is stored. On a feed card these are behind the matcher; here a tag
         * applied feed-wide is the thing to be able to see, since a keyword-less interest has no
         * second filter and a blanket tag is the whole of what reaches it.
         */}
        {event.tags.map((tag) => (
          <span className="ev-chip" key={tag}>
            {tag}
          </span>
        ))}
      </div>

      <div className="ev-actions">
        {/* rel is not optional on a link built from scraped markup. */}
        <a className="ev-link" href={event.url} target="_blank" rel="noopener noreferrer">
          {t.moreInfo}
        </a>
        <button className="ev-link" type="button" aria-expanded={open} onClick={onToggle}>
          {t.pipelineOpen}
        </button>
      </div>

      {open ? (
        <div className="ev-stages">
          {stageBlocks(event).map(({ stage, fields }) => (
            <section className="ev-stage" key={stage}>
              <h5 className="ev-stage-head">{stageLabel(stage, t)}</h5>
              <p className="ev-stage-note">{stageNote(stage, t)}</p>
              {/*
               * An empty stage prints a word rather than being left out. A pass that has not run
               * and a pass that ran and wrote nothing are the two states this tab exists to tell
               * apart, and a missing heading says neither.
               */}
              {Object.keys(fields).length === 0 ? (
                <p className="ev-stage-empty">{t.pipelineNoFields}</p>
              ) : (
                <Json value={fields} />
              )}
            </section>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/**
 * JSON, coloured.
 *
 * Tokens rather than markup — see `jsonView.ts`. Everything in this object is somebody else's
 * text: a scraped title, a venue name off a page, a sentence a model wrote. React escapes each
 * token like any other string, so none of it can become part of the document.
 */
function Json({ value }: { value: unknown }) {
  return (
    <pre className="ev-json">
      <code>
        {tokenizeJson(value).map((token, index) => (
          <span className={`ev-json-${token.kind}`} key={index}>
            {token.text}
          </span>
        ))}
      </code>
    </pre>
  );
}

function facetLabel(key: FacetKey, t: Translation): string {
  if (key === 'source') return t.facetSource;
  if (key === 'publication') return t.facetPublication;
  if (key === 'kind') return t.facetKind;
  if (key === 'reach') return t.facetReach;
  if (key === 'country') return t.facetCountry;
  if (key === 'city') return t.facetCity;
  if (key === 'tag') return t.facetTag;
  if (key === 'newsroom') return t.facetNewsroom;
  return t.facetField;
}

/**
 * The word on one button.
 *
 * Three sorts of value pass through here and they are labelled differently on purpose. A closed
 * vocabulary the app itself defines (`kind`, `reach`, the reader's verdicts) gets the same word the
 * card's chip carries, so a button and a chip can be matched by eye. A source id gets the name the
 * other two tabs use, because three tabs naming one source differently is worse than any of the
 * names. Everything else — a tag, a city, a field name — is the corpus's own string, printed as it
 * is stored: this is the tab where a tag with a stray capital is a thing you want to see.
 */
function optionLabel(key: FacetKey, value: string, label: string, t: Translation): string {
  if (value === ABSENT) return t.facetAbsent;
  if (key === 'source') return sourceName(value, value, t);
  if (key === 'country') return countryLabel(value);
  if (key === 'kind') return kindWordOf(value, t);
  if (key === 'reach') return reachWordOf(value, t);
  if (key === 'newsroom') return newsroomWord(value, t);
  return label;
}

function kindWordOf(kind: string, t: Translation): string {
  if (kind === 'announcement') return t.kindsAnnouncements;
  if (kind === 'coverage') return t.kindsCoverage;
  if (kind === 'listing') return t.kindsListings;
  return t.kindsUnlabelled;
}

function reachWordOf(reach: string, t: Translation): string {
  if (reach === 'local') return t.reachLocal;
  if (reach === 'national') return t.reachNational;
  if (reach === 'international') return t.reachInternational;
  return t.reachUnknown;
}

function newsroomWord(kind: string, t: Translation): string {
  if (kind === 'ticket-sale') return t.newsroomTicketSale;
  if (kind === 'programme') return t.newsroomProgramme;
  if (kind === 'practical') return t.newsroomPractical;
  if (kind === 'institutional') return t.newsroomInstitutional;
  return t.newsroomOther;
}

function stageLabel(stage: PipelineStage, t: Translation): string {
  if (stage === 'scraped') return t.stageScraped;
  if (stage === 'derived') return t.stageDerived;
  if (stage === 'newsroom') return t.stageNewsroom;
  if (stage === 'classifier') return t.stageClassifier;
  if (stage === 'shared') return t.stageShared;
  if (stage === 'bookkeeping') return t.stageBookkeeping;
  return t.stageOther;
}

function stageNote(stage: PipelineStage, t: Translation): string {
  if (stage === 'scraped') return t.stageScrapedNote;
  if (stage === 'derived') return t.stageDerivedNote;
  if (stage === 'newsroom') return t.stageNewsroomNote;
  if (stage === 'classifier') return t.stageClassifierNote;
  if (stage === 'shared') return t.stageSharedNote;
  if (stage === 'bookkeeping') return t.stageBookkeepingNote;
  return t.stageOtherNote;
}
