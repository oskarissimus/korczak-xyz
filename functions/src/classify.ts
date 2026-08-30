/*
 * Where an event is, and who it is for.
 *
 * The one question in this app nothing in a listing answers. A scrape gives a title, a date and a
 * free-text location; none of that distinguishes PyCon NL — a Dutch conference the Dutch attend —
 * from EuroPython, which people fly to. They can be in the same country in the same year. So this
 * is a judgement, and it is the only judgement here a language model makes.
 *
 * Three properties hold it in place, and each is load-bearing:
 *
 *   1. **It runs only here.** The browser never calls a model, and neither does the matcher. What
 *      crosses into `src/utils/events/` is the *result*, as two ordinary fields on the record —
 *      so the feed and the collector still answer "does this match?" with the same pure code, and
 *      `portable.test.ts` has nothing new to police.
 *   2. **Once per event.** `classifyHash` is what the verdict was computed from; unchanged hash,
 *      no second call. That is what makes a run over 1,100 events cost nothing after the first.
 *   3. **A failure is never fatal and never silent.** Bad JSON, a short array, a model that is
 *      down: the event stays unclassified, `matchReason` lets an unclassified event through, and
 *      `eventSources/classifier` records that nothing came back. The failure mode is the noise
 *      coming back visibly, never a feed that quietly empties.
 *
 * There is **no API key**. Vertex AI on Application Default Credentials, which inside a Cloud
 * Function is the function's own runtime service account — it is already inside the project the
 * model is billed to, so a credential to prove that would be a credential to leak and to rotate.
 * It also takes the classifier off the deploy path entirely: a secret named in a function's
 * `secrets` array must exist before the CLI will deploy anything at all, and the commit that first
 * added this one failed CI for exactly that reason.
 */

import { createHash } from 'node:crypto';
import { GoogleGenAI, Type, type Schema } from '@google/genai';
import type { EventRecord, Reach } from '../../korczak-xyz/src/utils/events/types';
import { REACHES } from '../../korczak-xyz/src/utils/events/types';
import { ONLINE } from '../../korczak-xyz/src/utils/events/countries';

/**
 * Cheapest and fastest of the family, which is the right trade for a two-field judgement over a
 * one-line listing. Pinned rather than tracking an alias: a model that changes under us changes
 * every verdict in the corpus, and that should be a commit.
 */
const MODEL = 'gemini-2.5-flash-lite';

/**
 * Where to ask.
 *
 * `global` rather than the functions' own `europe-central2`: the generative models are served from
 * a subset of regions that does not obviously include Warsaw, and the global endpoint is the one
 * with the fewest availability edges. This is the one constant to change if a run comes back with
 * a 404 on the model — `europe-west4` is the nearest regional alternative — and the live smoke
 * test is what settles it, before a deploy rather than after.
 */
const LOCATION = 'global';

/**
 * Bump to re-classify the whole corpus.
 *
 * The only lever for it, deliberately. It belongs in the code because "the prompt changed" is a
 * fact about a build, and a button in the UI would let a re-run happen with nobody able to say
 * afterwards which verdicts came from which prompt. It feeds `classifyHashOf`, so bumping it
 * invalidates every stored hash at once and the backlog drains over the next few runs.
 */
const CLASSIFIER_VERSION = 1;

/** Enough context to judge, few enough that a short reply loses little. */
const BATCH_SIZE = 25;
/** The model is the slow part; three in flight keeps a full backfill inside the 540s timeout. */
const CONCURRENCY = 3;
/**
 * A ceiling per run, so the first run after a deploy cannot spend its whole budget here.
 *
 * ~1,150 events therefore take about three runs to work through rather than risking a timeout that
 * would also lose the collection that came before it. `maxPerRun` on the notices is the same idea.
 */
const MAX_CLASSIFY_PER_RUN = 400;

/** Long enough for a slow batch, short enough that a hung call cannot eat the run. */
const REQUEST_TIMEOUT_MS = 60_000;

export interface Verdict {
  country?: string;
  reach?: Reach;
  reason?: string;
}

export interface ClassifyOutcome {
  /** How many records were written. */
  classified: number;
  /** How many were asked about but came back unusable — a model that answered nothing about them. */
  missing: number;
  /** How many still need classifying after this run, so a backlog is visible rather than inferred. */
  remaining: number;
  error?: string;
}

/*
 * The schema the reply is held to.
 *
 * `id` is in it because the reply is keyed by id and never by position — see `parseClassification`.
 * `reason` is capped in the prompt rather than the schema, since a schema cannot express a length
 * and a truncated sentence is worse than a short one.
 */
const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    events: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          country: { type: Type.STRING },
          reach: { type: Type.STRING, enum: [...REACHES] },
          reason: { type: Type.STRING },
        },
        required: ['id', 'country', 'reach', 'reason'],
      },
    },
  },
  required: ['events'],
};

/**
 * What the verdict was computed from.
 *
 * Only the fields the prompt actually shows. A price change or a new ticket link must not cost a
 * model call, and including the whole record would mean exactly that: `updatedAt` moves on every
 * run, so the hash would never match and every event would be re-classified forever.
 */
export function classifyHashOf(event: {
  title: string;
  subtitle?: string;
  venue?: string;
  city?: string;
  tags?: string[];
}): string {
  const parts = [
    String(CLASSIFIER_VERSION),
    event.title,
    event.subtitle ?? '',
    event.venue ?? '',
    event.city ?? '',
    (event.tags ?? []).join(','),
  ];
  return createHash('sha1').update(parts.join(' ')).digest('hex').slice(0, 16);
}

/** Whether this record's stored verdict was computed from what it says now. */
export function needsClassifying(event: EventRecord): boolean {
  return event.classifyHash !== classifyHashOf(event);
}

/**
 * What the model is shown, and what it is asked for.
 *
 * The definitions matter more than the instruction does: `national` and `international` are the
 * distinction this whole feature turns on, and "big" or "important" are not what is being asked.
 * The question is where the people in the room travelled from.
 */
export function buildPrompt(events: EventRecord[]): string {
  const rows = events.map((event) => ({
    id: event.id,
    title: event.title,
    subtitle: event.subtitle,
    venue: event.venue,
    city: event.city,
    tags: event.tags.slice(0, 6),
    date: event.day ?? undefined,
  }));

  return [
    'You are labelling public events for a personal event-watching app.',
    '',
    'For each event, return two facts:',
    '',
    '1. `country` — the ISO 3166-1 alpha-2 code of the country it is held in, uppercase.',
    `   Use "${ONLINE}" if it is an online-only event. Use "" if you genuinely cannot tell.`,
    '   Never guess a country from the language of the title alone.',
    '',
    '2. `reach` — where the people attending travel from:',
    '   - "local": drawn from one city or region. A night at the opera, a town fair,',
    '     a user-group meetup, a regional festival.',
    '   - "national": drawn mostly from within the host country. A national community',
    '     conference is this even when it is well known: PyCon NL, PyCon Cameroon,',
    '     PyCon Greece, PyCon Italia are all "national".',
    '   - "international": a substantial share of attendees travel from other countries.',
    '     EuroPython, FOSDEM, PyCon US, a major touring act, a festival with an',
    '     international programme.',
    '',
    'Judge by who travels there, not by how large or famous it is. A national conference',
    'with two thousand attendees is still "national". When a conference is named after a',
    'country or a city and has no other signal, prefer "national" over "international".',
    '',
    '3. `reason` — under 100 characters, in English, saying why you chose that reach.',
    '',
    'Reply with one object per event, echoing the `id` exactly as given.',
    '',
    JSON.stringify(rows),
  ].join('\n');
}

/**
 * The reply, as verdicts by event id.
 *
 * **Keyed by the id the model echoes back, never by position.** A reply one element short, or
 * reordered, would otherwise file every verdict after the gap against the wrong event — and it
 * would do it silently, producing a corpus of confident wrong countries with nothing to show
 * anything had gone wrong. An id that was never asked about is dropped for the same reason.
 *
 * Total by construction: malformed JSON, a missing field, an unknown reach, a schema from some
 * later build. Anything unreadable simply yields no verdict for that event, which leaves it
 * unclassified — a state the matcher already handles.
 */
export function parseClassification(text: string | undefined, asked: string[]): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  if (!text) return out;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return out;
  }

  const rows = (parsed as { events?: unknown })?.events;
  if (!Array.isArray(rows)) return out;

  const wanted = new Set(asked);
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const { id, country, reach, reason } = row as Record<string, unknown>;
    if (typeof id !== 'string' || !wanted.has(id)) continue;

    const verdict: Verdict = {};
    if (typeof country === 'string') {
      const code = country.trim().toUpperCase();
      // An ISO-2 code, or the token for nowhere. Anything else is not a country, and an empty
      // string is the model saying so, which is a real answer rather than a failure.
      if (/^[A-Z]{2}$/.test(code) || code === ONLINE) verdict.country = code;
    }
    if (typeof reach === 'string' && (REACHES as readonly string[]).includes(reach)) {
      verdict.reach = reach as Reach;
    }
    if (typeof reason === 'string' && reason.trim()) verdict.reason = reason.trim().slice(0, 200);

    // A row that produced neither fact is not a verdict; storing it would mark the event done.
    if (verdict.country || verdict.reach) out.set(id, verdict);
  }

  return out;
}

/**
 * The fields to write for one verdict.
 *
 * **A country the adapter supplied wins.** Teatr Wielki is in Warsaw and Ticketmaster is queried
 * `countryCode=PL`; those are facts, and a model is not asked to second-guess them. It fills in
 * what nobody knew and always supplies the reach, which no source has an opinion about.
 *
 * `classifyHash` is written whatever came back, including when only the reach did. Writing it only
 * on a complete verdict would put an event the model has no country for back in the queue on every
 * run, for the rest of its life.
 */
export function classificationUpdate(
  event: EventRecord,
  verdict: Verdict,
  now: number,
): Partial<EventRecord> {
  const update: Partial<EventRecord> = {
    classifiedAt: now,
    classifyHash: classifyHashOf(event),
  };
  if (!event.country && verdict.country) update.country = verdict.country;
  if (verdict.reach) update.reach = verdict.reach;
  if (verdict.reason) update.reachReason = verdict.reason;
  return update;
}

/**
 * Which events to spend this run's budget on, newest sighting first.
 *
 * Newest first because an event created in this same run is about to be considered for an
 * `announced` push, and the whole point of classifying before notifying is that the push decision
 * is made on a classified record. A backlog of older material can wait for the next run; a
 * notification cannot be taken back.
 */
export function queueForClassification(records: EventRecord[]): EventRecord[] {
  return records
    .filter(needsClassifying)
    .sort((a, b) => b.firstSeenAt - a.firstSeenAt);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * One batch, or nothing. A batch that throws is a batch of unclassified events, never a dead run.
 *
 * `models.generateContent` rather than the newer `interactions.create`: the latter is documented
 * against the Gemini Developer API, and `models` is what the SDK points Vertex clients at. This is
 * the only function in the file that touches a network, which is what let the whole switch away
 * from an API key leave every test in `classify.test.ts` untouched.
 */
async function classifyBatch(
  client: GoogleGenAI,
  events: EventRecord[],
): Promise<Map<string, Verdict>> {
  const response = await client.models.generateContent({
    model: MODEL,
    contents: buildPrompt(events),
    config: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  });
  return parseClassification(response.text, events.map((e) => e.id));
}

export interface ClassifyContext {
  now: number;
  /**
   * The Google Cloud project to bill and authenticate against.
   *
   * Absent means the classifier does not run, and that is a configuration state rather than a
   * failure — the shape the Ticketmaster adapter established. Nothing is classified, every event
   * stays unlabelled, and an unlabelled event passes the places rule, so the feed is exactly what
   * it was before any of this existed.
   */
  project?: string;
  location?: string;
  /** Writes one event's verdict. Separated so the whole loop is testable without a database. */
  write: (id: string, update: Partial<EventRecord>) => Promise<void>;
}

/**
 * Classify what needs it, within this run's budget.
 *
 * Writes are partial updates rather than a document rewrite: `upsertEvents` replaces the whole
 * document from what the source said, and the source has never heard of `reach`. Two writers, two
 * disjoint sets of fields, no coordination needed — which is also why `mergeRecord` has to carry
 * the classification fields forward, the way it already carries `firstSeenAt`.
 */
export async function classifyEvents(
  records: EventRecord[],
  ctx: ClassifyContext,
): Promise<{ records: EventRecord[]; outcome: ClassifyOutcome }> {
  const queue = queueForClassification(records);
  if (queue.length === 0) {
    return { records, outcome: { classified: 0, missing: 0, remaining: 0 } };
  }

  // Off GCP — a laptop with no ADC, a test that did not opt in — there is nothing to authenticate
  // as. See `ClassifyContext.project`: this is a configuration state, not a failure.
  if (!ctx.project) {
    return { records, outcome: { classified: 0, missing: 0, remaining: queue.length } };
  }

  const budget = queue.slice(0, MAX_CLASSIFY_PER_RUN);
  const client = new GoogleGenAI({
    vertexai: true,
    project: ctx.project,
    location: ctx.location ?? LOCATION,
  });
  const batches = chunk(budget, BATCH_SIZE);

  let classified = 0;
  let missing = 0;
  let firstError: string | undefined;
  /*
   * The verdicts, kept so the caller gets the same records the database now holds.
   *
   * `notifyAccount` runs next and decides pushes with `matchReason`, which reads `country` and
   * `reach`. Handing it the pre-classification copies would make every event look pending — which
   * passes the places rule — and the first run after a deploy would push about exactly the
   * national conferences this whole feature exists to stop pushing about.
   */
  const updates = new Map<string, Partial<EventRecord>>();

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const batch = batches[index];
      if (!batch) return;

      let verdicts: Map<string, Verdict>;
      try {
        verdicts = await classifyBatch(client, batch);
      } catch (error) {
        // One batch's worth of events stays unclassified. The run goes on; the reason is kept for
        // the health row, where a persistent outage becomes visible.
        firstError ??= error instanceof Error ? error.message : String(error);
        missing += batch.length;
        continue;
      }

      for (const event of batch) {
        const verdict = verdicts.get(event.id);
        if (!verdict) {
          missing += 1;
          continue;
        }
        const update = classificationUpdate(event, verdict, ctx.now);
        await ctx.write(event.id, update);
        updates.set(event.id, update);
        classified += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return {
    records: records.map((record) => {
      const update = updates.get(record.id);
      return update ? { ...record, ...update } : record;
    }),
    outcome: {
      classified,
      missing,
      remaining: queue.length - classified,
      ...(firstError ? { error: firstError } : {}),
    },
  };
}
