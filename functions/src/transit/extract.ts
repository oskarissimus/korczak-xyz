/*
 * Reading a communiqué.
 *
 * WTP writes prose, and the prose is the problem the app exists for: *"Od godz. 20:00 z powodu
 * awarii taboru pociągi metra linii M1 nie kursują na odcinku Centrum – Wilanowska. Zamknięte dla
 * pasażerów są stacje Politechnika, Pole Mokotowskie, Racławicka, Wierzbno oraz Wilanowska."* Every
 * fact wanted is in there — which stations, from when, why — and none of it is a field.
 *
 * So this is the same shape as the events app's `classify.ts`, for the same reasons, and the same
 * four properties hold it in place:
 *
 *   1. **It runs only here.** The browser never calls a model and neither does the matcher. What
 *      crosses into `src/utils/transit/` is the *result*, as ordinary fields — so the app and the
 *      collector still answer "does this touch my route?" with one pure function.
 *   2. **Once per revision.** `extractHash` is the digest of what was read; unchanged text, no
 *      second call. WTP edits a live communiqué as a closure develops, and re-reading it *then* is
 *      the whole point, while re-reading it every ten minutes is a bill for nothing.
 *   3. **Only the metro.** The title carries WTP's own list of affected lines, so whether an item
 *      is worth a model call is decided from a string the feed gave away for free. A fortnight of
 *      bus roadworks never reaches the model. See `EXTRACTED_LINES`.
 *   4. **A failure is never fatal and never silent.** Bad JSON, a short reply, a model that is
 *      down: the item stays unread, `impactOf` escalates an unread metro item to route level rather
 *      than clearing it, and `transitFeeds` records what happened. The failure mode is noise, never
 *      a quiet all-clear.
 *
 * No API key: Vertex AI on Application Default Credentials, which inside a Cloud Function is the
 * function's own service account. The argument is written out in `classify.ts` and applies
 * unchanged — a secret is not only something to rotate, it is something a deploy can fail on.
 */

import { GoogleGenAI, Type, type Schema } from '@google/genai';
import { STATIONS } from '../../../korczak-xyz/src/utils/transit/lines';
import { METRO_LINES, type MetroLine, type TransitItem } from '../../../korczak-xyz/src/utils/transit/types';

/**
 * The same model the events app classifies with: cheapest and fastest of the family.
 *
 * The right trade here too, though for a slightly different reason — this is not a judgement call
 * but a reading comprehension task over four sentences of well-formed Polish, which is the easiest
 * thing a model of this size does. Pinned rather than tracking an alias: a model that changes under
 * us changes every reading in the corpus, and that should be a commit.
 */
const MODEL = 'gemini-2.5-flash-lite';

/** See the note on `LOCATION` in `classify.ts`. Change this first if a run 404s on the model. */
const LOCATION = 'global';

/**
 * Bump to re-read the whole corpus.
 *
 * The only lever for it, and it belongs in the code: "the prompt changed" is a fact about a build,
 * and a re-run nobody can date afterwards is worse than no re-run. It feeds the stored hash, so
 * bumping invalidates every reading at once and the backlog drains over the next few runs.
 */
const EXTRACTOR_VERSION = 1;

/**
 * The lines whose prose is read at all.
 *
 * A deploy-time decision rather than a per-account one, and the distinction matters: the corpus is
 * shared by every account, so what gets read is a shared cost. What each reader configures is the
 * *route* — which stretch of which line they care about — and that is a per-account row in
 * `transitSegments`.
 *
 * Widening this to the trams is one edit here plus a station table for each line in `lines.ts`, and
 * it would multiply the model spend by roughly the number of lines added: the metro is two lines
 * out of some three hundred, and about eight communiqués a month.
 */
export const EXTRACTED_LINES: readonly MetroLine[] = METRO_LINES;

/** Communiqués are prose, so batches are small. Six items is roughly 20k characters. */
const BATCH_SIZE = 6;
/** Two in flight. The backlog is normally nil; this exists for the first run after a deploy. */
const CONCURRENCY = 2;
/** A ceiling per run. Two weeks of metro items is a few dozen, so this is never reached in steady state. */
const MAX_PER_RUN = 60;
const REQUEST_TIMEOUT_MS = 60_000;

/** How far from publication an extracted date may be before it is refused. See `parseWhen`. */
const MAX_DATE_DRIFT_MS = 180 * 86400000;

export interface Reading {
  lines?: MetroLine[];
  closedStops?: string[];
  wholeLine?: boolean;
  effectiveFrom?: number;
  effectiveUntil?: number;
  reason?: string;
  summary?: string;
}

export interface ExtractOutcome {
  read: number;
  /** Asked about but came back unusable. */
  missing: number;
  /** Still queued after this run, so a backlog is visible rather than inferred. */
  remaining: number;
  error?: string;
}

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          lines: { type: Type.ARRAY, items: { type: Type.STRING, enum: [...METRO_LINES] } },
          /*
           * Free strings, deliberately, though an enum of all 38 station names would fit.
           *
           * An enum would force every answer onto a name this build knows — which turns "a station
           * I have never heard of" into "the nearest one I was offered", silently. Unresolvable
           * names are how `impactOf` learns it cannot clear an item, and that signal is worth more
           * than the tidiness. The prompt names the stations; the schema does not enforce them.
           */
          closedStops: { type: Type.ARRAY, items: { type: Type.STRING } },
          wholeLine: { type: Type.BOOLEAN },
          from: { type: Type.STRING },
          until: { type: Type.STRING },
          reason: { type: Type.STRING },
          summary: { type: Type.STRING },
        },
        required: ['id', 'lines', 'closedStops', 'wholeLine', 'from', 'until', 'reason', 'summary'],
      },
    },
  },
  required: ['items'],
};

/** The digest of what a reading was computed from. Version-prefixed, so a prompt change invalidates. */
export function extractHashOf(item: Pick<TransitItem, 'contentHash'>): string {
  return `${EXTRACTOR_VERSION}:${item.contentHash}`;
}

export function needsExtracting(item: TransitItem): boolean {
  if (!isExtractable(item)) return false;
  return item.extractHash !== extractHashOf(item);
}

/** Whether this item is one the model is ever shown. The cheap gate — see `EXTRACTED_LINES`. */
export function isExtractable(item: TransitItem): boolean {
  return item.titleLines.some((line) => (EXTRACTED_LINES as readonly string[]).includes(line));
}

/**
 * What the model is shown.
 *
 * The station list is in the prompt, per line, and it is the single most load-bearing part of it:
 * without it the model returns whatever the prose called a place — *"odcinek Centrum – Wilanowska"*
 * as one string, or *"stacje na Ursynowie"* — and `canonicalStation` places none of that. With it,
 * the instruction is an expansion task over a fixed vocabulary, which is a much easier thing to ask.
 *
 * **Segments must be expanded.** Polish communiqués state closures as a stretch (*"na odcinku
 * Centrum – Wilanowska"*) at least as often as they list stations, and a stretch this app cannot
 * expand is a closure it cannot place on a route.
 *
 * The answers stay in **Polish**. Every station name is Polish, the reason is a phrase lifted from
 * the source, and a lock screen reading `Centrum – Wilanowska · awaria taboru` is the same string
 * in both locales. Translating it would put a second reading between the reader and the operator's
 * own words, which is exactly what the Raw tab exists to let them check.
 */
export function buildPrompt(items: TransitItem[]): string {
  const rows = items.map((item) => ({
    id: item.id,
    title: item.title,
    published: new Date(item.publishedAt).toISOString(),
    text: item.body ?? '',
  }));

  return [
    'You are reading official Warsaw public-transport notices (Warszawski Transport Publiczny).',
    'Each notice is in Polish and concerns one or more transport lines. Only the two metro lines',
    'matter here; ignore everything the notice says about buses, trams and trains.',
    '',
    'The stations, in order along each line. Use these exact spellings and no others:',
    ...METRO_LINES.map((line) => `  ${line}: ${STATIONS[line].join(', ')}`),
    '',
    'For each notice return:',
    '',
    '1. `lines` — which of M1, M2 the notice actually concerns. Empty if it concerns neither.',
    '',
    '2. `closedStops` — every station where trains do NOT stop for passengers, as a result of this',
    '   notice. Expand ranges: "nie kursują na odcinku Centrum – Wilanowska" means every station',
    '   from Centrum to Wilanowska inclusive, listed one by one. A station the notice says is',
    '   closed, skipped, or passed without stopping belongs here. Return an empty list if the',
    '   notice closes no station — reduced frequency, a broken lift, a delay, or a notice about',
    '   replacement buses only. Never list a station the notice does not concern.',
    '',
    '3. `wholeLine` — true only if the entire line is suspended end to end.',
    '',
    '4. `from` and `until` — when the disruption starts and ends, as ISO-8601 with the Warsaw',
    '   offset (e.g. 2026-08-27T20:00:00+02:00). The notice often gives a time without a date, in',
    '   which case use the notice\'s own publication date, given below as `published`. Use "" for',
    '   either one the notice does not state — "do odwołania" (until further notice) means `until`',
    '   is "". Never guess.',
    '',
    '5. `reason` — the stated cause, in Polish, at most 80 characters, copied from the notice\'s own',
    '   wording ("awaria taboru", "prace modernizacyjne", "zdarzenie z udziałem pasażera"). Use ""',
    '   if the notice states no cause. Do not invent one.',
    '',
    '6. `summary` — one line of Polish, at most 120 characters, saying what is happening.',
    '',
    'Reply with one object per notice, echoing the `id` exactly as given.',
    '',
    JSON.stringify(rows),
  ].join('\n');
}

/**
 * The reply, as readings by item id.
 *
 * **Keyed by the id the model echoes back, never by position** — a reply one element short would
 * otherwise file every reading after the gap against the wrong communiqué, silently, and produce a
 * corpus of confident wrong station lists with nothing anywhere to say so. That is `classify.ts`'s
 * rule and it is worth more here, where a wrong reading is a route the app says is clear.
 *
 * Total by construction: malformed JSON, a missing field, an unknown line, a date from another
 * century. Anything unreadable simply yields no reading for that item, which leaves it unread — a
 * state `impactOf` already handles by escalating.
 */
export function parseReadings(
  text: string | undefined,
  asked: TransitItem[],
): Map<string, Reading> {
  const out = new Map<string, Reading>();
  if (!text) return out;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return out;
  }

  const rows = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(rows)) return out;

  const byId = new Map(asked.map((item) => [item.id, item]));

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== 'string') continue;
    const item = byId.get(id);
    if (!item) continue;

    const reading: Reading = {};

    if (Array.isArray(record.lines)) {
      const lines = record.lines.filter((line): line is MetroLine =>
        typeof line === 'string' && (METRO_LINES as readonly string[]).includes(line),
      );
      reading.lines = [...new Set(lines)];
    }

    if (Array.isArray(record.closedStops)) {
      reading.closedStops = [
        ...new Set(
          record.closedStops
            .filter((stop): stop is string => typeof stop === 'string')
            .map((stop) => stop.trim())
            .filter(Boolean)
            .slice(0, 40),
        ),
      ];
    }

    if (typeof record.wholeLine === 'boolean') reading.wholeLine = record.wholeLine;

    const from = parseWhen(record.from, item.publishedAt);
    if (from !== null) reading.effectiveFrom = from;
    const until = parseWhen(record.until, item.publishedAt);
    if (until !== null) reading.effectiveUntil = until;

    if (typeof record.reason === 'string' && record.reason.trim()) {
      reading.reason = record.reason.trim().slice(0, 120);
    }
    if (typeof record.summary === 'string' && record.summary.trim()) {
      reading.summary = record.summary.trim().slice(0, 200);
    }

    /*
     * A row that produced no station list at all is not a reading, and storing one would mark the
     * item read — which would take it out of the queue *and* out of the escalation `impactOf`
     * applies to unread items, leaving it silently filed as somebody else's problem. An empty list
     * is fine; an absent one is not.
     */
    if (reading.closedStops !== undefined || reading.wholeLine === true) out.set(id, reading);
  }

  return out;
}

/**
 * A stated time as epoch ms, or null.
 *
 * The drift guard is the one worth explaining: a model asked for a date it was not given will
 * occasionally produce one — the current year with the notice's month, or a plausible-looking
 * 2024. A closure six months either side of its own announcement is not a date, it is an invention,
 * and storing it would put a card on screen claiming a disruption ended before it started.
 */
export function parseWhen(value: unknown, publishedAt: number): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const at = Date.parse(value.trim());
  if (!Number.isFinite(at)) return null;
  if (Math.abs(at - publishedAt) > MAX_DATE_DRIFT_MS) return null;
  return at;
}

/** The fields to write for one reading. */
export function readingUpdate(
  item: TransitItem,
  reading: Reading,
  now: number,
): Partial<TransitItem> {
  const update: Partial<TransitItem> = {
    extractedAt: now,
    extractHash: extractHashOf(item),
    // Cleared explicitly: a successful read after a failed one must not leave last week's error
    // sitting on the card. `stripUndefined` would drop it, so the empty string is the erasure.
    extractError: '',
    closedStops: reading.closedStops ?? [],
    wholeLine: reading.wholeLine === true,
  };
  if (reading.lines) update.lines = reading.lines;
  if (reading.effectiveFrom !== undefined) update.effectiveFrom = reading.effectiveFrom;
  if (reading.effectiveUntil !== undefined) update.effectiveUntil = reading.effectiveUntil;
  if (reading.reason) update.reason = reading.reason;
  if (reading.summary) update.summary = reading.summary;
  return update;
}

/** Which items to spend this run's budget on, newest first. A backlog can wait; a push cannot. */
export function queueForExtraction(items: TransitItem[]): TransitItem[] {
  return items.filter(needsExtracting).sort((a, b) => b.publishedAt - a.publishedAt);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface ExtractContext {
  now: number;
  /** Absent means the extractor does not run. A configuration state, not a failure — see `classify.ts`. */
  project?: string;
  location?: string;
  write: (id: string, update: Partial<TransitItem>) => Promise<void>;
}

export async function extractItems(
  items: TransitItem[],
  ctx: ExtractContext,
): Promise<{ items: TransitItem[]; outcome: ExtractOutcome }> {
  const queue = queueForExtraction(items);
  if (queue.length === 0) return { items, outcome: { read: 0, missing: 0, remaining: 0 } };
  if (!ctx.project) return { items, outcome: { read: 0, missing: 0, remaining: queue.length } };

  const budget = queue.slice(0, MAX_PER_RUN);
  const client = new GoogleGenAI({
    vertexai: true,
    project: ctx.project,
    location: ctx.location ?? LOCATION,
  });
  const batches = chunk(budget, BATCH_SIZE);

  let read = 0;
  let missing = 0;
  let firstError: string | undefined;
  const updates = new Map<string, Partial<TransitItem>>();

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const batch = batches[next++];
      if (!batch) return;

      let readings: Map<string, Reading>;
      try {
        const response = await client.models.generateContent({
          model: MODEL,
          contents: buildPrompt(batch),
          config: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
            abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
        });
        readings = parseReadings(response.text, batch);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        firstError ??= message;
        missing += batch.length;
        /*
         * The failure is written onto each item rather than only into the health row. An unread
         * metro item is escalated to route priority by `impactOf`, and the card has to be able to
         * say why it is shouting — otherwise a model outage looks like a fortnight of mysterious
         * high-priority alerts about nothing in particular.
         */
        for (const item of batch) {
          const update = { extractError: message.slice(0, 300) };
          await ctx.write(item.id, update).catch(() => undefined);
          updates.set(item.id, update);
        }
        continue;
      }

      for (const item of batch) {
        const reading = readings.get(item.id);
        if (!reading) {
          missing += 1;
          continue;
        }
        const update = readingUpdate(item, reading, ctx.now);
        await ctx.write(item.id, update);
        updates.set(item.id, update);
        read += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return {
    /*
     * The caller gets the records the database now holds. `notifyAccount` runs next and decides
     * with `impactOf`, which reads `closedStops` — handed the pre-extraction copies it would see
     * every item as unread, escalate all of them, and turn the first run after a deploy into a
     * stream of uncertain route alerts about closures that were read seconds earlier.
     */
    items: items.map((item) => {
      const update = updates.get(item.id);
      return update ? { ...item, ...update } : item;
    }),
    outcome: {
      read,
      missing,
      remaining: queue.length - read,
      ...(firstError ? { error: firstError } : {}),
    },
  };
}
