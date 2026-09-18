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
 * The keys are in here in the clear, as sloper's are, and that is not fixable by encrypting them:
 * anything the page can decrypt to call OpenAI with, script on this origin can decrypt too. See
 * `.claude/rules/backseat.md` for the trade in full.
 */

import { isQuotaError } from '../../lib/localStorage';
import { describeError, log } from '../../lib/logger';
import { normalizeConfig } from './defaults';
import type { BackseatConfig } from './types';

export const CONFIG_KEY = 'backseat-config';

export interface StampedConfig {
  config: BackseatConfig;
  /** When this copy was last edited, by whichever device edited it. 0 means "never". */
  updatedAt: number;
}

export function loadConfig(): StampedConfig {
  if (typeof window === 'undefined') return { config: normalizeConfig(null), updatedAt: 0 };

  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { config: normalizeConfig(null), updatedAt: 0 };

    const parsed = JSON.parse(raw);
    return {
      config: normalizeConfig(parsed),
      updatedAt: typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch (e) {
    // A corrupt value is worth one line: it is the difference between "my key vanished" and "my
    // key vanished and nobody can say why".
    log.warn('backseat.config.load.failed', describeError(e));
    return { config: normalizeConfig(null), updatedAt: 0 };
  }
}

export function saveConfig(config: BackseatConfig, updatedAt: number): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...config, updatedAt }));
  } catch (e) {
    // Nothing to evict — this app owns one key and it is already the smallest it can be. The
    // report is the point: a silent failure here is what makes a key "not stick" after a reload.
    log.warn(
      isQuotaError(e) ? 'backseat.config.save.full' : 'backseat.config.save.failed',
      describeError(e),
    );
  }
}

export function clearConfig(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    // Removing a key that cannot be removed leaves the defaults in memory, which is what the
    // caller asked for. Nothing to report and nothing to do.
  }
}
