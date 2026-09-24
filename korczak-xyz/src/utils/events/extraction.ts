/*
 * What a model was asked about a source's rows, and how much of it has come back.
 *
 * The Sources tab answers "where does this come from, and how would I know if that were wrong".
 * Two of the facts it draws are about the *fetch* — the pages, and whether the last run got
 * anything. This file is the other: of the rows a source produced, which fields no page ever
 * stated, and how many of them a model has actually filled in.
 *
 * It is here rather than hard-coded per source because **which pass reads a row is a fact about the
 * row, not about the scrape**. `needsClassifying` skips anything tagged `newsroom` and
 * `readNewsroom` reads nothing else, so a source that starts tagging its pages `newsroom` moves
 * between the two passes without a line changing anywhere — and a table in the UI claiming
 * otherwise would be wrong with nothing to catch it. Counting the tag on the rows themselves is
 * the same argument `pullSourceHealth` makes about health: ask the corpus, do not describe it.
 *
 * Portable like everything else in this directory: facts and field names, no prose. The words for
 * a pass and the sentence explaining it are in `Events/translations.ts`, where they have a locale.
 */

import { isNewsroomItem } from './newsroom';
import { asksKind, skipsClassifier } from './sources';
import type { EventRecord } from './types';

/** Which model pass wrote a field. Two, and they are kept apart for `events.md`'s three reasons. */
export type ModelPass = 'classifier' | 'newsroom';

export interface ExtractedField {
  /** The `EventRecord` field, as the record spells it. The UI names it; this counts it. */
  field: keyof EventRecord;
  /** Rows of this source carrying a value for it. */
  present: number;
  /**
   * True where a source states this field itself whenever it knows it, and the model only fills the
   * gaps — `country` is the one. Shown, because a count of 480 against a classifier that has
   * reached 300 rows is otherwise a contradiction on the screen rather than the ordinary case.
   */
  shared?: boolean;
}

export interface PassCoverage {
  pass: ModelPass;
  /** Rows of this source the pass is asked about at all. */
  rows: number;
  /**
   * Rows it has answered — by the stamp it writes rather than by any one verdict, because a call
   * can come back with two of three fields and a pass that declined to guess is not a pass that has
   * not run.
   */
  answered: number;
  /** What it writes, in the order the prompt asks for it. */
  fields: ExtractedField[];
}

/**
 * The fields each pass writes, and nothing else.
 *
 * Deliberately not every field the stage owns: `classifyHash`, `classifiedAt`, `reachReason` and
 * their newsroom equivalents are how the pass avoids re-asking and how it explains itself, and a
 * list of eleven field names answers a different question from the one being asked here — which is
 * *what did a model decide about this row*.
 */
const CLASSIFIER_FIELDS: ReadonlyArray<{ field: keyof EventRecord; shared?: boolean }> = [
  { field: 'kind' },
  { field: 'reach' },
  { field: 'country', shared: true },
];

const NEWSROOM_FIELDS: ReadonlyArray<{ field: keyof EventRecord; shared?: boolean }> = [
  { field: 'newsroomTicketSale' },
  { field: 'onSaleAt', shared: true },
];

/** Present: not undefined, not null, not the empty string, not an empty array. */
export function hasValue(event: EventRecord, field: keyof EventRecord): boolean {
  const value = (event as unknown as Record<string, unknown>)[field as string];
  if (value === undefined || value === null || value === '') return false;
  return !(Array.isArray(value) && value.length === 0);
}

/**
 * The model passes over one source's rows, each with what it has managed so far.
 *
 * **A pass with no rows is left out, and a pass with rows and no answers is not.** They are the two
 * states this is drawn for: a source the reader never touches is not a fault and does not belong on
 * the screen, where a source whose rows it should have read and has not is the classifier having
 * stopped — which is the single most likely way the model half of this app fails quietly. Nothing
 * filters on a verdict any more, so a stopped classifier no longer empties or floods anything; what
 * it does is leave every card saying `?` where it should say where the event is, and a count stuck
 * at zero against a full scrape is what that looks like before anybody notices the chips.
 */
export function modelPasses(events: EventRecord[]): PassCoverage[] {
  const newsroom = events.filter(isNewsroomItem);
  const classified = events.filter((event) => !isNewsroomItem(event) && !skipsClassifier(event));

  // A source of listings only is never asked the kind, so a `kind` count stuck at zero there would
  // read as a stopped classifier rather than a question nobody asks.
  const classifierFields = classified.some(asksKind)
    ? CLASSIFIER_FIELDS
    : CLASSIFIER_FIELDS.filter(({ field }) => field !== 'kind');

  return [
    coverageOf('classifier', classified, classifierFields, (event) => event.classifiedAt),
    coverageOf('newsroom', newsroom, NEWSROOM_FIELDS, (event) => event.newsroomReadAt),
  ].filter((pass) => pass.rows > 0);
}

function coverageOf(
  pass: ModelPass,
  rows: EventRecord[],
  fields: ReadonlyArray<{ field: keyof EventRecord; shared?: boolean }>,
  stampOf: (event: EventRecord) => number | undefined,
): PassCoverage {
  return {
    pass,
    rows: rows.length,
    answered: rows.filter((event) => stampOf(event) !== undefined).length,
    fields: fields.map(({ field, shared }) => ({
      field,
      present: rows.filter((event) => hasValue(event, field)).length,
      ...(shared ? { shared: true } : {}),
    })),
  };
}
