/*
 * Baby sleep log — the shape of the record, and what counts as a believable one.
 *
 * One entry is one contiguous stretch of sleep — and *contiguous* is the whole of it. A night broken
 * by a waking is therefore two entries with a gap between them, not one entry carrying a list of
 * wakings: nothing here needs a new field, and the merge rule that already handles two rows handles
 * it without being told anything. A night's total is its blocks added up, which `groupByDay` does,
 * and `nightBlocks` in `stats.ts` is where the blocks are read back as one night.
 *
 * `end: null` means the sleep is in progress. Such an entry is a real, durable record the instant
 * the button writes it — it needs no crash recovery, and it syncs, so a second device shows
 * "asleep now". But it has no duration, so no statistic may count it.
 *
 * Three fields exist only so two devices can be reconciled without asking a human anything:
 * `rev`, `updatedAt` and `writerId`. See `merge.ts`.
 */

import { getClientId, uuid } from '../../lib/clientId';

export type SleepKind = 'night' | 'nap';

export interface SleepEntry {
  id: string;
  kind: SleepKind;
  /** Epoch ms the baby fell asleep. */
  start: number;
  /** Epoch ms the baby woke, or null while the sleep is still running. */
  end: number | null;
  /**
   * Local edit counter, from 0. This is the *primary* merge comparator, in preference to
   * `updatedAt`: a device whose clock runs fast would otherwise win every merge forever, silently,
   * however stale its data. A counter is immune to that because it only counts this device's own
   * edits to this entry.
   */
  rev: number;
  /** Epoch ms of the last local edit. A tiebreak when two devices are at the same `rev`. */
  updatedAt: number;
  /** Which browser profile last wrote it — the final, deterministic tiebreak. */
  writerId: string;
  /**
   * Who logged it, once the log is shared with a second account.
   *
   * Set when the entry is created and never changed afterwards: it answers "who recorded this
   * sleep", which a later correction does not alter. `writerId` cannot stand in for it — that is a
   * browser profile, so one person on a phone and a laptop is two writers, and it is reassigned on
   * every edit.
   *
   * Optional, and it must stay optional: everything logged before sharing existed lacks it, as does
   * anything logged while signed out.
   */
  authorEmail?: string;
  /** Tombstone. Never removed by an edit: a delete is absorbing. See `pickEntry`. */
  deleted?: boolean;
}

/** A new or edited entry as a form holds it, before it becomes a record. */
export interface EntryDraft {
  kind: SleepKind;
  start: number;
  end: number | null;
}

// --- what is believable ------------------------------------------------------------------------

/*
 * A sleep log's characteristic failure is not a wrong number, it is a *forgotten* one: someone taps
 * "fell asleep", the baby wakes, nobody taps "woke up", and the entry runs for thirty hours. A
 * single entry like that destroys every mean in the window.
 *
 * So implausible entries are excluded from every statistic and never silently clamped — a
 * fabricated wake time is worse than a gap, because nothing on the page would show it was invented.
 * The log tab surfaces them instead and asks the human to fix or discard.
 */

/** Below this a "sleep" is a mis-tap, not a sleep. */
export const MIN_SLEEP_MS = 5 * 60_000;
export const MAX_NAP_MS = 5 * 60 * 60_000;
export const MAX_NIGHT_MS = 16 * 60 * 60_000;

export function maxSleepMs(kind: SleepKind): number {
  return kind === 'night' ? MAX_NIGHT_MS : MAX_NAP_MS;
}

export type DraftError = 'no-start' | 'end-before-start' | 'too-short' | 'too-long' | 'future' | 'overlap';

/** Do two entries cover any of the same time? Touching endpoints do not overlap. */
export function overlaps(
  a: { start: number; end: number | null },
  b: { start: number; end: number | null },
  now: number
): boolean {
  const aEnd = a.end ?? now;
  const bEnd = b.end ?? now;
  return a.start < bEnd && b.start < aEnd;
}

/**
 * Whether a draft is worth storing. `others` are the live entries it must not collide with, so an
 * edit has to exclude itself from that list before calling.
 */
export function validateDraft(draft: EntryDraft, others: SleepEntry[], now: number): DraftError | null {
  if (!Number.isFinite(draft.start)) return 'no-start';
  if (draft.start > now) return 'future';
  if (draft.end != null) {
    if (draft.end <= draft.start) return 'end-before-start';
    if (draft.end > now) return 'future';
    const ms = draft.end - draft.start;
    if (ms < MIN_SLEEP_MS) return 'too-short';
    if (ms > maxSleepMs(draft.kind)) return 'too-long';
  }
  if (others.some((other) => !other.deleted && overlaps(draft, other, now))) return 'overlap';
  return null;
}

/**
 * Whether a stored entry can be believed, and therefore counted.
 *
 * An entry still running is judged against how long it has *already* run: a nap open for eleven
 * hours is a forgotten timer whatever it eventually says.
 */
export function isPlausible(entry: SleepEntry, now: number): boolean {
  if (entry.deleted) return false;
  if (!Number.isFinite(entry.start) || entry.start > now) return false;
  const end = entry.end ?? now;
  const ms = end - entry.start;
  if (ms > maxSleepMs(entry.kind)) return false;
  return entry.end == null ? true : ms >= MIN_SLEEP_MS;
}

/** A running entry that has run too long to believe — what the log tab must ask about. */
export function isStale(entry: SleepEntry, now: number): boolean {
  return !entry.deleted && entry.end == null && now - entry.start > maxSleepMs(entry.kind);
}

// --- constructing and editing ------------------------------------------------------------------

/**
 * `author` is the signed-in address, or undefined when nobody is signed in. `editEntry` and
 * `tombstone` spread `prev`, so it needs no parameter of its own there — it rides along with every
 * later revision of the same entry.
 */
export function newEntry(draft: EntryDraft, now: number, author?: string): SleepEntry {
  return {
    id: uuid(),
    kind: draft.kind,
    start: draft.start,
    end: draft.end,
    rev: 0,
    updatedAt: now,
    writerId: getClientId(),
    ...(author ? { authorEmail: author } : {}),
  };
}

export function editEntry(prev: SleepEntry, patch: Partial<EntryDraft>, now: number): SleepEntry {
  return {
    ...prev,
    ...patch,
    rev: prev.rev + 1,
    updatedAt: now,
    writerId: getClientId(),
  };
}

export function tombstone(prev: SleepEntry, now: number): SleepEntry {
  return { ...prev, deleted: true, rev: prev.rev + 1, updatedAt: now, writerId: getClientId() };
}

/**
 * Coerce an untrusted record — from localStorage written by an older build, or from Firestore —
 * into an entry, or reject it. Returns null rather than throwing, so one bad document cannot take
 * the whole log down with it.
 */
export function normalizeEntry(raw: unknown): SleepEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  if (r.kind !== 'night' && r.kind !== 'nap') return null;
  if (typeof r.start !== 'number' || !Number.isFinite(r.start)) return null;
  const end = r.end;
  if (end != null && (typeof end !== 'number' || !Number.isFinite(end))) return null;
  const rev = typeof r.rev === 'number' && r.rev >= 0 ? Math.floor(r.rev) : 0;
  const updatedAt =
    typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : r.start;
  return {
    id: r.id,
    kind: r.kind,
    start: r.start,
    end: end == null ? null : (end as number),
    rev,
    updatedAt,
    writerId: typeof r.writerId === 'string' ? r.writerId : '',
    // Spread conditionally rather than assigned, so an entry without an author has no key at all.
    // `setDoc` rejects an explicit `undefined`, and this record goes straight to Firestore.
    ...(typeof r.authorEmail === 'string' && r.authorEmail !== ''
      ? { authorEmail: r.authorEmail }
      : {}),
    ...(r.deleted === true ? { deleted: true as const } : {}),
  };
}

// --- stats -------------------------------------------------------------------------------------

export type WindowChoice = '3d' | '7d' | '30d' | 'custom';

export interface TimeWindow {
  from: number;
  /** Exclusive. */
  to: number;
}

/** One local day's sleep. One night, in however many blocks a waking broke it into; any naps. */
export interface DayBucket {
  /** Local `yyyy-mm-dd`. */
  key: string;
  /** Epoch ms of local midnight opening the day. */
  start: number;
  /** Local midnight closing it — not `start + 86_400_000`, which is wrong twice a year. */
  end: number;
  /**
   * The night's blocks added up, or null when no believable closed night is attributed to this day.
   * Non-null does not mean the night is *finished* — a night whose second block is still running has
   * its first block counted here. `nightBlocks` is what answers that question.
   */
  nightMs: number | null;
  napMs: number;
  naps: number;
  /** Believable entries attributed to this day, running ones included, for the timeline to draw. */
  entries: SleepEntry[];
  /** Whether this day still expects more sleep — today, essentially. */
  partial: boolean;
}

/** A mean with its spread and, crucially, how many days went into it. */
export interface MeanStat {
  mean: number | null;
  sd: number | null;
  n: number;
}

/**
 * A mean of clock times. Clock times are circular, so `mean` is a direction and can be genuinely
 * undefined — see `circular.ts`.
 */
export interface ClockStat extends MeanStat {
  /** Mean resultant length, 0–1. Near 0 the times are spread right around the clock. */
  r: number;
}

export interface SleepStats {
  days: DayBucket[];
  /** Total sleep per day. Counts only days with a believable closed night, so today does not sag it. */
  totalPerDay: MeanStat;
  nightPerDay: MeanStat;
  /** How many times a night was broken by a waking. A night slept through contributes a real 0. */
  nightWakes: MeanStat;
  /** Time awake between the blocks of one night — the part of the night that was not sleep. */
  nightAwake: MeanStat;
  napPerDay: MeanStat;
  napsPerDay: MeanStat;
  napLength: MeanStat;
  /**
   * How long he was awake between two sleeps — the activity windows.
   *
   * The first is the morning wake-up to the first nap, the second is the first nap to the second.
   * Two figures rather than one mean over every gap: the morning sets one and the length of the
   * first nap sets the other, so an average of the two answers neither.
   */
  firstWakeWindow: MeanStat;
  secondWakeWindow: MeanStat;
  bedtime: ClockStat;
  wakeTime: ClockStat;
  /** The first nap of the day. A mean over *all* nap starts averages the 9am and 3pm nap into noon. */
  firstNapStart: ClockStat;
  napStart: ClockStat;
}

// --- sync --------------------------------------------------------------------------------------

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error';

export interface SyncState {
  status: SyncStatus;
  /** Entries written locally that the cloud has not acknowledged. */
  pending: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}
