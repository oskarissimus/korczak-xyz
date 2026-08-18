/*
 * What the room was like on a given night — and whether that turned out to be a mistake.
 *
 * Two facts, learnt at two different moments. In the evening you know the forecast overnight low
 * and whether you left the window open; in the morning you know whether the baby was cold. The
 * question the pair answers is the one nobody can answer from memory: **how low can it go before
 * the window has to be shut.**
 *
 * ## A night is two records, not one
 *
 * The obvious shape is one document per night carrying all three fields. It is wrong for the same
 * reason a night broken by a waking is two sleep entries rather than one entry with a `wakes: [...]`
 * array: the two halves are written by two separate acts, hours apart, and on a shared log usually
 * by **two different people on two different phones**. A single record makes those halves compete
 * in a whole-record last-write-wins merge, so if either phone is offline across the gap, one half of
 * the night is silently dropped — and neither person can tell, because the row is still there.
 *
 * Two records never compete: they have different ids, so the union-by-id merge in `versioned.ts`
 * keeps both without being told anything, and no new merge rule exists to get wrong.
 *
 * ## The id is derived from the night
 *
 * `${night}-${part}` rather than a `uuid()`, so two devices logging the same evening converge on
 * one row instead of producing two that no merge can join. It splits at the **last** hyphen: a
 * `yyyy-mm-dd` key contains two of its own, which is the same trap `parseManifestParam` documents.
 *
 * Nothing here reads the clock. `now` is always a parameter.
 */

import { getClientId } from '../../lib/clientId';
import { addDays, dayKeyAt, dayStart } from './days';
import type { Versioned } from './versioned';

/** Which half of the night a record is. */
export type ClimatePart = 'eve' | 'am';

export type WindowState = 'open' | 'closed';

/** The morning's answer. `ok` is "alright", not "perfect" — it is the verdict you act on. */
export type NightVerdict = 'cold' | 'ok' | 'warm';

export const WINDOW_STATES: readonly WindowState[] = ['open', 'closed'];
export const VERDICTS: readonly NightVerdict[] = ['cold', 'ok', 'warm'];

export interface ClimateRecord extends Versioned {
  /** Local `yyyy-mm-dd` of the night's *evening*. The join key between the two halves. */
  night: string;
  part: ClimatePart;
  /** Forecast overnight low in °C. Evening records only; null until it is entered. */
  tempC: number | null;
  /** Evening records only. */
  window: WindowState | null;
  /** Morning records only. */
  verdict: NightVerdict | null;
  /**
   * Who recorded it. Set on creation and never changed by an edit — it answers who *logged* the
   * night, which a later correction does not alter. `writerId` cannot stand in for it: that is a
   * browser profile, so one person on a phone and a laptop is two writers.
   */
  authorEmail?: string;
}

/** What a form holds for one half of a night, before it becomes a record. */
export interface EveningDraft {
  tempC: number | null;
  window: WindowState | null;
}

// --- ids and days ------------------------------------------------------------------------------

export function climateId(night: string, part: ClimatePart): string {
  return `${night}-${part}`;
}

/** Split a climate id back into its night and its half, or null if it is not one. */
export function parseClimateId(id: string): { night: string; part: ClimatePart } | null {
  const cut = id.lastIndexOf('-');
  if (cut <= 0) return null;
  const night = id.slice(0, cut);
  const part = id.slice(cut + 1);
  if (part !== 'eve' && part !== 'am') return null;
  if (!isNightKey(night)) return null;
  return { night, part };
}

export function isNightKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(dayStart(key));
}

/**
 * Which night the quick-entry card is about, at this instant.
 *
 * Before noon you are logging the morning of the night that started *yesterday*; after noon you are
 * logging tonight. Deliberately not `sleepDayKey`, whose `NIGHT_CUTOFF_HOUR` of 6 files an 07:00
 * event under today — right for a sleep that began at 07:00, wrong for a verdict on the night that
 * just ended. Noon is the boundary because nothing about a night is logged at midday, so no real
 * entry sits near enough to it to be filed wrongly by an hour.
 */
export function currentNightKey(now: number): string {
  return new Date(now).getHours() < 12 ? dayKeyAt(addDays(now, -1)) : dayKeyAt(now);
}

// --- what is believable ------------------------------------------------------------------------

/*
 * A forecast low, not a measurement, so the believable range is the outdoor one for a Polish
 * bedroom window. The bounds exist to catch a fat-fingered `112`, not to police the weather.
 */
export const MIN_TEMP_C = -40;
export const MAX_TEMP_C = 45;

export type TempError = 'not-a-number' | 'out-of-range';

/**
 * Parse what was typed into a temperature, or say why not. An empty field is not an error — it is
 * the half you have not filled in yet — so it comes back as `{ ok: true, tempC: null }`.
 */
export function parseTemp(raw: string): { ok: true; tempC: number | null } | { ok: false; error: TempError } {
  const text = raw.trim().replace(',', '.');
  if (text === '') return { ok: true, tempC: null };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, error: 'not-a-number' };
  if (value < MIN_TEMP_C || value > MAX_TEMP_C) return { ok: false, error: 'out-of-range' };
  // One decimal is as fine as a forecast gets, and it keeps the axis labels short.
  return { ok: true, tempC: Math.round(value * 10) / 10 };
}

// --- constructing and editing --------------------------------------------------------------------

function blank(night: string, part: ClimatePart, now: number, author?: string): ClimateRecord {
  return {
    id: climateId(night, part),
    night,
    part,
    tempC: null,
    window: null,
    verdict: null,
    rev: 0,
    updatedAt: now,
    writerId: getClientId(),
    ...(author ? { authorEmail: author } : {}),
  };
}

/**
 * The evening half of a night, new or revised.
 *
 * `prev` is whatever the log already holds for that half, so the id and the author survive an edit
 * and `rev` moves forward — which is what makes the revision, not the wall clock, decide the merge.
 */
export function setEvening(
  night: string,
  draft: EveningDraft,
  now: number,
  prev?: ClimateRecord,
  author?: string
): ClimateRecord {
  const base = prev ?? blank(night, 'eve', now, author);
  return revise(base, { tempC: draft.tempC, window: draft.window }, now, prev != null);
}

export function setVerdict(
  night: string,
  verdict: NightVerdict | null,
  now: number,
  prev?: ClimateRecord,
  author?: string
): ClimateRecord {
  const base = prev ?? blank(night, 'am', now, author);
  return revise(base, { verdict }, now, prev != null);
}

/**
 * Apply a payload change and move the revision on.
 *
 * `deleted` is dropped rather than set to false: a tombstone written to again is alive — the human
 * has just entered a value into it — and an explicit `undefined` is the one thing `setDoc` rejects.
 */
function revise(
  base: ClimateRecord,
  patch: Partial<Pick<ClimateRecord, 'tempC' | 'window' | 'verdict'>>,
  now: number,
  existed: boolean
): ClimateRecord {
  const { deleted: _gone, ...live } = base;
  return {
    ...live,
    ...patch,
    rev: existed ? base.rev + 1 : 0,
    updatedAt: now,
    writerId: getClientId(),
  };
}

export function tombstoneClimate(prev: ClimateRecord, now: number): ClimateRecord {
  return { ...prev, deleted: true, rev: prev.rev + 1, updatedAt: now, writerId: getClientId() };
}

/**
 * Coerce an untrusted record — from localStorage written by an older build, or from Firestore —
 * into a `ClimateRecord`, or reject it. Returns null rather than throwing, so one bad document
 * cannot take the whole log down with it.
 *
 * This is an **allow-list**: the object is rebuilt field by field, so a field added to
 * `ClimateRecord` and not added here is silently stripped on every read and every pull.
 */
export function normalizeClimate(raw: unknown): ClimateRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  const parsed = parseClimateId(r.id);
  if (!parsed) return null;
  // The id is the truth: it is the document name, and `night`/`part` are its two halves written out
  // for readability. A record whose fields disagree with its own id is taken at its id.
  const tempC =
    typeof r.tempC === 'number' && Number.isFinite(r.tempC) ? (r.tempC as number) : null;
  const window = r.window === 'open' || r.window === 'closed' ? r.window : null;
  const verdict =
    r.verdict === 'cold' || r.verdict === 'ok' || r.verdict === 'warm' ? r.verdict : null;
  const rev = typeof r.rev === 'number' && r.rev >= 0 ? Math.floor(r.rev) : 0;
  const updatedAt =
    typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt)
      ? (r.updatedAt as number)
      : dayStart(parsed.night);
  return {
    id: r.id,
    night: parsed.night,
    part: parsed.part,
    // An evening record has no verdict and a morning record has no temperature, whatever a stray
    // document claims: the two halves exist precisely so they cannot overwrite each other.
    tempC: parsed.part === 'eve' ? tempC : null,
    window: parsed.part === 'eve' ? window : null,
    verdict: parsed.part === 'am' ? verdict : null,
    rev,
    updatedAt,
    writerId: typeof r.writerId === 'string' ? r.writerId : '',
    // Spread conditionally rather than assigned: `setDoc` rejects an explicit `undefined`, and this
    // record goes straight to Firestore.
    ...(typeof r.authorEmail === 'string' && r.authorEmail !== ''
      ? { authorEmail: r.authorEmail }
      : {}),
    ...(r.deleted === true ? { deleted: true as const } : {}),
  };
}

