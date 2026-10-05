/*
 * The settings, in this browser.
 *
 * One key, one small JSON object, the same shape as sloper's and for the same reasons — including
 * the one that says what is NOT here. A ride produces a camera frame every fifteen seconds and a
 * line of text about it; the frames are hundreds of kilobytes each and the origin's ~5 MB is
 * shared with the typing trainer's `typedHistory`, so an hour's drive would evict a book to store
 * pictures of a windscreen nobody will look at again. The remarks alone would fit, and they are
 * still not kept: what makes a passenger's needling funny is that it is happening now, and a log
 * of it read back cold is just a list of complaints about a road you are no longer on.
 *
 * So: the settings survive a reload and a ride does not.
 *
 * `updatedAt` rides along and is the entire conflict resolution between this browser and the
 * account — see cloud.ts. It is a client clock, which is exactly as trustworthy as it sounds;
 * what it is asked to settle is "which of my own two devices did I last type a key on".
 *
 * The keys are not in here any more: since Oct 2026 they are the account's, shared with every
 * app (`utils/accountKeys/`), and what is saved here has its `apiKeys` emptied.
 */

import { isQuotaError } from '../../lib/localStorage';
import { describeError, log } from '../../lib/logger';
import { DEFAULT_CONFIG, normalizeConfig } from './defaults';
import { BACKSEAT, type Flavour } from './flavour';
import type { BackseatConfig } from './types';

/** The passenger's key. Each app has its own (`flavour.configKey`), so neither overwrites the other. */
export const CONFIG_KEY = BACKSEAT.configKey;

export interface StampedConfig {
  config: BackseatConfig;
  /** When this copy was last edited, by whichever device edited it. 0 means "never". */
  updatedAt: number;
  /**
   * Somebody has decided what the settings here are. It meant "the keys" when this app kept its
   * own and borrowed sloper's into an undecided copy; the keys are the account's now, and the flag
   * is kept and written so that a document an older build reads still means what it meant.
   */
  settled: boolean;
}

/**
 * The config with its keys emptied. The keys are the account's since Oct 2026
 * (`utils/accountKeys/`); a copy kept here would be a second place to miss when one is revoked.
 */
export function withoutKeys(config: BackseatConfig): BackseatConfig {
  return { ...config, apiKeys: DEFAULT_CONFIG.apiKeys };
}

/** What this browser holds. */
export function loadConfig(flavour: Flavour = BACKSEAT): StampedConfig {
  if (typeof window === 'undefined') {
    return { config: normalizeConfig(null, flavour), updatedAt: 0, settled: false };
  }

  try {
    const raw = localStorage.getItem(flavour.configKey);
    if (!raw) return { config: normalizeConfig(null, flavour), updatedAt: 0, settled: false };

    const parsed = JSON.parse(raw);
    return {
      config: normalizeConfig(parsed, flavour),
      updatedAt: typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : 0,
      settled: parsed?.settled === true,
    };
  } catch (e) {
    // A corrupt value is worth one line: it is the difference between "my settings vanished" and
    // "my settings vanished and nobody can say why".
    log.warn('backseat.config.load.failed', describeError(e));
    return { config: normalizeConfig(null, flavour), updatedAt: 0, settled: false };
  }
}

export function saveConfig(
  config: BackseatConfig,
  updatedAt: number,
  settled: boolean,
  flavour: Flavour = BACKSEAT,
): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(flavour.configKey, JSON.stringify({ ...withoutKeys(config), updatedAt, settled }));
  } catch (e) {
    // Nothing to evict — this app owns one key and it is already the smallest it can be. The
    // report is the point: a silent failure here is what makes a key "not stick" after a reload.
    log.warn(
      isQuotaError(e) ? 'backseat.config.save.full' : 'backseat.config.save.failed',
      describeError(e),
    );
  }
}

export function clearConfig(flavour: Flavour = BACKSEAT): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(flavour.configKey);
  } catch {
    // Removing a key that cannot be removed leaves the defaults in memory, which is what the
    // caller asked for. Nothing to report and nothing to do.
  }
}
