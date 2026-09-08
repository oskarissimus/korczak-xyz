/*
 * The corpus read as a pipeline rather than as a feed.
 *
 * Every other view of `events/` answers "what is on". This one answers "what did the scrape
 * actually get, and which pass wrote which half of it" — the question you have when a card looks
 * wrong and there is no way to tell whether the page said something odd, the upsert derived
 * something odd from it, or a model made something up.
 *
 * Two halves, and they are the two halves of that question:
 *
 *   - **`FIELD_STAGES`**, which names the stage that writes every field of an `EventRecord`. It is
 *     a `Record` over `keyof EventRecord` on purpose: a field added to the record without being
 *     placed here is a compile error rather than a field that quietly stops being shown. The one
 *     thing it cannot catch is a field a *future build* wrote into a document this one has never
 *     heard of, which is why `stageBlocks` keeps an `other` bucket — the same argument the Sources
 *     tab's "Also reporting" list is built on.
 *   - **The facets**, which are the same multi-select shape the Feed toolbar uses (`kindOptions`,
 *     `cityOptions`), generalised over every field that has a vocabulary worth picking from.
 *
 * Portable like everything else in this directory — no DOM, no React, no prose. The words on the
 * buttons are the component's job, exactly as they are for `sources.ts`: this file holds facts, and
 * a label here would be a label with no locale. The one exception is a value the corpus itself
 * spells (a city, a tag, a country code), which is data rather than a word we chose.
 */

import { cityKeyOf, cityOptions } from './feed';
import { TICKET_SALE_VERDICTS, ticketSaleVerdictOf } from './newsroom';
import { foldText } from './normalize';
import { KINDS, REACHES, type EventRecord } from './types';

/**
 * Which pass of the collector writes a field.
 *
 * `shared` is the one that needs explaining and it is the honest answer rather than a hedge: three
 * fields have more than one writer, by design. `mergeRecord` takes an incoming `country` and
 * `onSaleAt` where the source stated one and keeps the stored value otherwise (usually a model's),
 * and `tags` is the union of what the source said and the tag a reader's sale date earns. Filing
 * any of the three under one stage would be a claim the record cannot support.
 *
 * `other` is never assigned here — it is what `stageBlocks` puts a field it does not recognise in.
 */
export type PipelineStage =
  | 'scraped'
  | 'derived'
  | 'newsroom'
  | 'classifier'
  | 'shared'
  | 'bookkeeping'
  | 'other';

/**
 * The stages in the order the collector runs them: `fetch → upsert → read → classify`, with the
 * two book-keeping groups after, and `other` last because it should normally be empty.
 */
export const PIPELINE_STAGES: readonly PipelineStage[] = [
  'scraped',
  'derived',
  'newsroom',
  'classifier',
  'shared',
  'bookkeeping',
  'other',
];

/**
 * What wrote each field.
 *
 * `scraped` is exactly the `RawEvent` surface — what an adapter read off a page, and nothing else.
 * `derived` is what `toRecord` computes from it in one place so no adapter can get normalisation
 * subtly different. The two model passes own their own verdicts and the hashes that stop them
 * being re-asked. `bookkeeping` is what only the upsert can know, because it is about the
 * *transition* rather than about the event: when this app first saw the row, and when it first saw
 * a ticket link on it.
 */
export const FIELD_STAGES: Record<keyof EventRecord, Exclude<PipelineStage, 'other'>> = {
  // What the page said.
  sourceKey: 'scraped',
  title: 'scraped',
  subtitle: 'scraped',
  url: 'scraped',
  ticketUrl: 'scraped',
  startsAt: 'scraped',
  endsAt: 'scraped',
  allDay: 'scraped',
  dateText: 'scraped',
  publishedAt: 'scraped',
  city: 'scraped',
  venue: 'scraped',

  // What `toRecord` worked out from it.
  id: 'derived',
  source: 'derived',
  sourceName: 'derived',
  haystack: 'derived',
  day: 'derived',
  distancesM: 'derived',
  fingerprint: 'derived',

  // `readNewsroom.ts`, over the rows a source tagged `newsroom`.
  newsroomTicketSale: 'newsroom',
  newsroomReadAt: 'newsroom',
  newsroomHash: 'newsroom',

  // `classify.ts`, over the whole corpus.
  reach: 'classifier',
  reachReason: 'classifier',
  kind: 'classifier',
  kindReason: 'classifier',
  classifiedAt: 'classifier',
  classifyHash: 'classifier',

  // More than one writer. See `PipelineStage`.
  country: 'shared',
  tags: 'shared',
  onSaleAt: 'shared',

  // Only the upsert can know these: they are about the transition, not about the event.
  firstSeenAt: 'bookkeeping',
  onSaleSeenAt: 'bookkeeping',
  updatedAt: 'bookkeeping',
};

/** Declaration order, so a field sits in the same place in every row's JSON. */
const FIELD_ORDER = Object.keys(FIELD_STAGES) as Array<keyof EventRecord>;

export interface StageBlock {
  stage: PipelineStage;
  /** The fields this stage wrote on this row, in `FIELD_STAGES` order. Empty where it has not run. */
  fields: Record<string, unknown>;
}

/**
 * One row, split into what each pass of the collector put there.
 *
 * **Every stage is returned, empty ones included** — which is the whole reason this is a list of
 * blocks rather than a filtered object. A row the classifier has never reached and a row it
 * labelled are different things, and a missing heading says neither: an empty `classifier` block
 * is the pipeline visibly not having got here yet, which is the state this tab exists to show.
 *
 * `other` is the exception and is returned only when it holds something. It is a field written by
 * a build this one is not — a rollback, or a deploy in flight — and an empty heading for it on
 * every row would be noise about a case that is almost never live.
 */
export function stageBlocks(event: EventRecord): StageBlock[] {
  const record = event as unknown as Record<string, unknown>;
  const blocks = new Map<PipelineStage, Record<string, unknown>>(
    PIPELINE_STAGES.map((stage) => [stage, {}]),
  );

  for (const field of FIELD_ORDER) {
    const value = record[field as string];
    if (value === undefined) continue;
    blocks.get(FIELD_STAGES[field])![field as string] = value;
  }

  // Anything this build has never heard of. Sorted, since there is no declaration order to follow.
  for (const key of Object.keys(record).sort()) {
    if (key in FIELD_STAGES || record[key] === undefined) continue;
    blocks.get('other')![key] = record[key];
  }

  return PIPELINE_STAGES.filter(
    (stage) => stage !== 'other' || Object.keys(blocks.get('other')!).length > 0,
  ).map((stage) => ({ stage, fields: blocks.get(stage)! }));
}

/**
 * The fields whose *presence* is worth counting, in the order they are offered.
 *
 * This is the `field` facet, and it is the one that reads as a report rather than as a filter:
 * `publishedAt (312)` against 1,150 rows says outright that 838 rows carry no publication date,
 * which is the sort of thing you go to this tab to find out and which no per-row view can tell
 * you. The required fields are left out — `id`, `title` and `updatedAt` are on every row by
 * construction, so a count of them is a count of the corpus.
 *
 * `startsAt`, `day` and `tags` are in it although they are always *written*: null and the empty
 * array are the answers that matter here, and `hasValue` reads both as absent.
 */
export const OPTIONAL_FIELDS: ReadonlyArray<keyof EventRecord> = [
  'subtitle',
  'startsAt',
  'day',
  'endsAt',
  'allDay',
  'dateText',
  'publishedAt',
  'city',
  'venue',
  'ticketUrl',
  'onSaleAt',
  'onSaleSeenAt',
  'tags',
  'distancesM',
  'country',
  'reach',
  'kind',
  'classifiedAt',
  'newsroomTicketSale',
];

/** Present, for the purposes of the `field` facet: not undefined, not null, not empty. */
export function hasValue(event: EventRecord, field: keyof EventRecord): boolean {
  const value = (event as unknown as Record<string, unknown>)[field as string];
  if (value === undefined || value === null || value === '') return false;
  return !(Array.isArray(value) && value.length === 0);
}

/**
 * Every axis of the corpus that has a vocabulary worth picking from.
 *
 * A field with a value per row (`title`, `url`, a timestamp) is not one of these: a filter whose
 * options are as numerous as its rows is a list, not a filter. What is left is the closed
 * vocabularies the two model passes write, the small open ones the sources supply, and `field`,
 * which is presence rather than value.
 */
export type FacetKey =
  | 'source'
  | 'publication'
  | 'kind'
  | 'reach'
  | 'country'
  | 'city'
  | 'tag'
  | 'newsroom'
  | 'field';

export const FACET_KEYS: readonly FacetKey[] = [
  'source',
  'publication',
  'kind',
  'reach',
  'country',
  'city',
  'tag',
  'newsroom',
  'field',
];

/**
 * The value standing for "this row has no answer on this axis".
 *
 * A key of its own on **every** facet here, which is deliberately not what the Feed does: there,
 * `cityOptions` declines to offer the absent bucket because "somewhere unspecified" is not a place
 * anyone picks. This tab is the opposite question — the rows nothing has judged, nothing placed, or
 * nothing tagged are exactly what you come here to count, and a facet that cannot ask for them
 * cannot show you the hole. The `newsroom` axis is the clearest case: its two values are what the
 * reader decided, and `ABSENT` is every row it has never looked at.
 *
 * The empty string, because that is what a missing optional string field already is once folded,
 * and because it can never collide with a real value: no tag, city, code or verdict is empty.
 */
export const ABSENT = '';

const FACET_VALUES: Record<FacetKey, (event: EventRecord) => string[]> = {
  /*
   * Which *adapter* produced the row — the first half of its id, and what `eventSources` health and
   * the Sources tab are both keyed on. Five of them, and they are how a scrape is named everywhere
   * else in this app.
   */
  source: (event) => [event.source],
  /*
   * Which *publication* it came off, which is a finer question and not the same one. The RSS
   * adapter reads a list of unrelated magazines, so `feed` alone cannot tell a race report on
   * Maraton Warszawski from a history article on historia.org.pl — and those are exactly the rows
   * whose extraction is worth judging separately. A hierarchy rather than a duplicate: on the four
   * sources that are one place, the two rows say the same thing, which is the true thing.
   */
  publication: (event) => [event.sourceName || ABSENT],
  kind: (event) => [event.kind ?? ABSENT],
  reach: (event) => [event.reach ?? ABSENT],
  country: (event) => [event.country ?? ABSENT],
  // Through `cityKey`, so `Warsaw` and `Warszawa` are one option here as they are one ask in an
  // interest. The label comes back as whichever spelling the corpus prefers — see `facetsOf`.
  city: (event) => [cityKeyOf(event) || ABSENT],
  // The one multi-valued facet among the vocabularies: a row carries every tag it was given, and
  // picking two tags asks for rows carrying either, like every other row of buttons here.
  tag: (event) => (event.tags?.length ? event.tags : [ABSENT]),
  newsroom: (event) => [ticketSaleVerdictOf(event) ?? ABSENT],
  /*
   * Presence rather than value, and the one facet that can answer with nothing at all: a row
   * carrying none of the optional fields has no value on this axis, so it survives no selection of
   * one. That is right — it is a row that has none of them — and it is why this returns a list
   * rather than falling back to `ABSENT`, which here would read as "absent from everything" and
   * count every row in the corpus.
   */
  field: (event) => OPTIONAL_FIELDS.filter((field) => hasValue(event, field)).map(String),
};

/**
 * Fixed orders, for the axes that have one.
 *
 * `KIND_KEYS`' argument, reaching every closed vocabulary: these are buttons, and a row whose
 * buttons swap places as the corpus changes is one you press the wrong half of. The open
 * vocabularies (sources, countries, cities, tags) have no order to fix and are sorted by count,
 * commonest first, which is what makes the long tail of a mis-tagging visible at the end of the row.
 */
const FACET_ORDER: Partial<Record<FacetKey, readonly string[]>> = {
  kind: KINDS,
  reach: REACHES,
  newsroom: TICKET_SALE_VERDICTS,
  field: OPTIONAL_FIELDS.map(String),
};

export interface FacetOption {
  /** What a selection stores. `ABSENT` for the rows with no answer on this axis. */
  value: string;
  /** The corpus's own spelling of it, where it has one. Never a translated word — see the header. */
  label: string;
  count: number;
}

export interface Facet {
  key: FacetKey;
  options: FacetOption[];
}

/** What is chosen on each axis. An absent or empty set is no constraint, never "matches nothing". */
export type FacetSelection = ReadonlyMap<FacetKey, ReadonlySet<string>>;

export const NO_FACETS: FacetSelection = new Map();

/**
 * Whether one row survives a selection.
 *
 * **Any-of within an axis, all-of across them** — the shape every multi-select in this app has, and
 * the only one whose counts can be read off the buttons. And **an empty selection is no
 * constraint**, which is `match.ts`'s rule for a keyword-less interest arriving here for the third
 * time: read the other way, this tab would open on nothing at all for anybody who has not pressed a
 * button.
 */
export function matchesFacets(event: EventRecord, selection: FacetSelection): boolean {
  for (const key of FACET_KEYS) {
    const chosen = selection.get(key);
    if (!chosen || chosen.size === 0) continue;
    if (!FACET_VALUES[key](event).some((value) => chosen.has(value))) return false;
  }
  return true;
}

export function applyFacets(events: EventRecord[], selection: FacetSelection): EventRecord[] {
  return events.filter((event) => matchesFacets(event, selection));
}

/**
 * Every axis with its options, each counted over the rows that the *other* axes leave.
 *
 * The Feed's rule for its three controls, generalised: a count has to say what pressing that button
 * would show, or it promises a bigger list than it lands on. Counting each facet over the fully
 * filtered set instead would make every unchosen option in a narrowed view read zero, which is the
 * one number that makes a filter look broken.
 *
 * A chosen value the corpus no longer holds is kept at zero rather than dropped — `withSelectedKeys`
 * in the Feed, made general. A button that takes itself off the screen leaves a view narrowed to
 * nothing with nothing to press to undo it.
 */
export function facetsOf(events: EventRecord[], selection: FacetSelection): Facet[] {
  // Whichever spelling the corpus prefers for each city, over the *whole* corpus rather than the
  // narrowed one: a label that changed as the filters moved would read as a different city.
  const cityLabels = new Map(cityOptions(events).map((option) => [option.key, option.label]));

  return FACET_KEYS.map((key) => {
    const others = new Map(selection);
    others.delete(key);

    const counts = new Map<string, number>();
    for (const event of applyFacets(events, others)) {
      for (const value of FACET_VALUES[key](event)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    for (const value of selection.get(key) ?? []) {
      if (!counts.has(value)) counts.set(value, 0);
    }

    const order = FACET_ORDER[key];
    const options = [...counts].map(([value, count]) => ({
      value,
      label: key === 'city' ? (cityLabels.get(value) ?? value) : value,
      count,
    }));

    options.sort((a, b) => {
      // The rows with no answer are always last: they are the absence of a value rather than one
      // of them, whichever way the rest of the row is ordered.
      if ((a.value === ABSENT) !== (b.value === ABSENT)) return a.value === ABSENT ? 1 : -1;
      if (order) return order.indexOf(a.value) - order.indexOf(b.value);
      return b.count - a.count || a.label.localeCompare(b.label);
    });

    return { key, options };
  });
}

/** One axis toggled, as a new selection. The component holds no set-mutating code of its own. */
export function toggleFacet(
  selection: FacetSelection,
  key: FacetKey,
  value: string,
): FacetSelection {
  const next = new Map(selection);
  const chosen = new Set(next.get(key) ?? []);
  if (chosen.has(value)) chosen.delete(value);
  else chosen.add(value);
  if (chosen.size === 0) next.delete(key);
  else next.set(key, chosen);
  return next;
}

/** How many axes are narrowing the view — what the "clear everything" control is drawn from. */
export function chosenCount(selection: FacetSelection): number {
  let total = 0;
  for (const key of FACET_KEYS) total += selection.get(key)?.size ?? 0;
  return total;
}

/**
 * Whether a typed query matches the words on an option.
 *
 * Through `foldText`, which is the whole reason this is here rather than an inline `includes`: it
 * is the one normalisation this app compares anything with, so typing `krakow` reaches `Kraków`,
 * `zydowsk` reaches `Żydowski`, and a filter box behaves like the matcher does. A second folding
 * written beside it would agree until the first bug fix.
 *
 * Every whitespace-separated term must appear, in any order — `teatr opera` finds
 * `Teatr Wielki – Opera Narodowa` where a single substring would not. An empty query matches
 * everything, which is what makes an unfiltered list the thing a focused box shows.
 *
 * It matches the **text on the option**, not its stored value: the button reading `Poland` is keyed
 * `PL`, and somebody typing `pol` is looking at the word, not at the code.
 */
export function matchesQuery(text: string, query: string): boolean {
  const terms = foldText(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = foldText(text);
  return terms.every((term) => haystack.includes(term));
}

/**
 * The four fields a decision is made on, as one object.
 *
 * The stage blocks below answer "which pass wrote this", which is the right question when a value
 * looks wrong and the wrong one when you are just reading the row: seven panels and thirty fields
 * to find out whether tickets go on sale and when. These four are what the filters, the interests
 * and the notices actually key on — is it a sale announcement, when does the sale open, how far
 * does the event reach, and is the row an event at all — so they are lifted out and everything
 * else goes behind a disclosure.
 *
 * **Absent is written as `null` rather than left out**, for the same reason an empty stage prints a
 * word: a key missing from a four-key object is a thing you have to already know to notice, and
 * "the classifier has not reached this row" is exactly what a reader is here to see.
 *
 * `onSaleAt` arrives already in words — `saleWhenLabel` in `feed.ts`, in the reader's locale —
 * because a millisecond stamp is the one field on this list nobody can read, and a locale is the
 * one thing this directory may not have. It is the caller's, like every other word on the tab.
 */
export interface BusinessFacts {
  newsroomTicketSale: boolean | null;
  onSaleAt: string | null;
  reach: string | null;
  kind: string | null;
}

export function businessOf(event: EventRecord, onSaleAt: string | null): BusinessFacts {
  return {
    newsroomTicketSale: event.newsroomTicketSale ?? null,
    onSaleAt,
    reach: event.reach ?? null,
    kind: event.kind ?? null,
  };
}
