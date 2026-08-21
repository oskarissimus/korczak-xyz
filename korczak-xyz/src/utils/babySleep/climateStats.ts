/*
 * Reading the two halves of each night back as one night, and answering the question they exist for.
 *
 * Nothing here reads the clock, and nothing here rounds an answer into being: a night counts towards
 * the threshold only when it has *both* a temperature and a verdict, because a forecast with no
 * morning after it is not evidence of anything.
 */

import { dayStart } from './days';
import { climateId, type ClimateRecord, type NightVerdict, type WindowState } from './climate';
import { applyLocal, mergeById, sameRevision } from './versioned';

// --- merging ------------------------------------------------------------------------------------

function isSameVersion(a: ClimateRecord, b: ClimateRecord): boolean {
  return (
    sameRevision(a, b) &&
    a.tempC === b.tempC &&
    a.window === b.window &&
    a.verdict === b.verdict
  );
}

/** Newest night first, and deterministically so — the id tiebreak keeps the merge commutative. */
function byNightDesc(a: ClimateRecord, b: ClimateRecord): number {
  return b.night.localeCompare(a.night) || a.id.localeCompare(b.id);
}

export interface ClimateMergeResult {
  records: ClimateRecord[];
  changed: boolean;
  localWins: string[];
}

export function mergeClimate(
  local: ClimateRecord[],
  remote: ClimateRecord[]
): ClimateMergeResult {
  return mergeById(local, remote, isSameVersion, byNightDesc);
}

/** This device's own write to a night's climate record, applied to its own copy. */
export function applyLocalClimate(
  records: ClimateRecord[],
  changed: ClimateRecord[]
): ClimateRecord[] {
  return applyLocal(records, changed, byNightDesc);
}

export function visibleClimate(records: ClimateRecord[]): ClimateRecord[] {
  return records.filter((r) => !r.deleted).sort(byNightDesc);
}

// --- joining --------------------------------------------------------------------------------------

/** One night, as the list and the chart want it: both halves, side by side. */
export interface NightObservation {
  /** Local `yyyy-mm-dd`. */
  night: string;
  /** Local midnight opening that day — the x-value convention the other charts use. */
  at: number;
  tempC: number | null;
  window: WindowState | null;
  verdict: NightVerdict | null;
  /** Whoever logged either half, for the "logged by" line on a shared log. */
  authorEmail?: string;
}

/** Whether a night says anything at all, i.e. is worth a row. */
export function isEmptyNight(night: NightObservation): boolean {
  return night.tempC == null && night.window == null && night.verdict == null;
}

/** A night that can be counted: a temperature, a window state and a verdict. */
export function isComplete(
  night: NightObservation
): night is NightObservation & { tempC: number; window: WindowState; verdict: NightVerdict } {
  return night.tempC != null && night.window != null && night.verdict != null;
}

/**
 * Join the halves. Newest night first.
 *
 * Tombstoned records are dropped first, so clearing one half leaves the other standing — which is
 * what "clear the verdict, I mis-tapped" has to mean.
 */
export function groupByNight(records: ClimateRecord[]): NightObservation[] {
  const byNight = new Map<string, NightObservation>();
  for (const record of visibleClimate(records)) {
    let night = byNight.get(record.night);
    if (!night) {
      night = {
        night: record.night,
        at: dayStart(record.night),
        tempC: null,
        window: null,
        verdict: null,
      };
      byNight.set(record.night, night);
    }
    if (record.part === 'eve') {
      night.tempC = record.tempC;
      night.window = record.window;
    } else {
      night.verdict = record.verdict;
    }
    if (record.authorEmail && !night.authorEmail) night.authorEmail = record.authorEmail;
  }
  return [...byNight.values()]
    .filter((night) => !isEmptyNight(night))
    .sort((a, b) => b.night.localeCompare(a.night));
}

/** The two records making up one night, by id — what an edit needs in order to move `rev` on. */
export function recordsFor(records: ClimateRecord[], night: string) {
  const byId = new Map(records.map((r) => [r.id, r]));
  return {
    eve: byId.get(climateId(night, 'eve')),
    am: byId.get(climateId(night, 'am')),
  };
}

// --- the threshold ---------------------------------------------------------------------------------

/**
 * How cold it has been allowed to get, for one window state.
 *
 * Deliberately the min and max of the two populations rather than a fitted cutoff. It is
 * explainable from the dots on the chart — *the coldest night that was fine, the warmest that was
 * not* — and where the two overlap, that overlap is a real fact about the nights and is shown as
 * one rather than smoothed into a false precision. `warm` counts as not-cold: the question is only
 * ever about the bottom end.
 */
export interface Threshold {
  /** Lowest temperature a night in this window state was *not* too cold. */
  okFloor: number | null;
  /** Highest temperature a night in this window state *was* too cold. */
  coldCeiling: number | null;
  /** Complete nights in this window state. */
  n: number;
  nCold: number;
  /** Whether the two populations separate — i.e. whether the answer is settled so far. */
  settled: boolean;
}

/** Below this there is not enough evidence to say anything, however clean it looks. */
export const MIN_NIGHTS = 3;

export function windowThreshold(nights: NightObservation[], window: WindowState): Threshold {
  let okFloor: number | null = null;
  let coldCeiling: number | null = null;
  let n = 0;
  let nCold = 0;

  for (const night of nights) {
    if (!isComplete(night) || night.window !== window) continue;
    n += 1;
    if (night.verdict === 'cold') {
      nCold += 1;
      if (coldCeiling == null || night.tempC > coldCeiling) coldCeiling = night.tempC;
    } else if (okFloor == null || night.tempC < okFloor) {
      okFloor = night.tempC;
    }
  }

  // No cold night yet is settled — you simply have not found the floor. An overlap is not.
  const settled =
    n >= MIN_NIGHTS && okFloor != null && (coldCeiling == null || coldCeiling < okFloor);

  return { okFloor, coldCeiling, n, nCold, settled };
}
