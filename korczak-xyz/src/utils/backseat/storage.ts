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
import {
  anyKey,
  borrowFromBrowser,
  configWithBorrowedKeys,
  shouldBorrow,
  sloperKeysInBrowser,
} from './importKeys';
import type { BackseatConfig } from './types';

export const CONFIG_KEY = 'backseat-config';

export interface StampedConfig {
  config: BackseatConfig;
  /** When this copy was last edited, by whichever device edited it. 0 means "never". */
  updatedAt: number;
  /**
   * True when the keys in it were borrowed from the video generation wizard rather than typed
   * here. The setup sheet says so under the key; nothing else behaves differently.
   */
  borrowed: boolean;
  /**
   * Somebody has decided what the keys here are — by typing one, by clearing one, or by pressing
   * Clear everything. It is what stops a cleared key being borrowed straight back, and it is
   * written on purpose rather than inferred from a document existing. See `importKeys.ts`.
   */
  settled: boolean;
}

/**
 * What this browser holds — or, when it holds nothing, what the wizard next door does.
 *
 * THE BORROWED COPY IS STAMPED 0, WHICH IS THE WHOLE OF ITS CONFLICT RESOLUTION. `updatedAt: 0`
 * means "never edited", so it loses to any copy the account has: a device that borrowed sloper's
 * keys this morning cannot overwrite the ones somebody typed here last week. It still pushes up
 * when the account has no copy at all, which is the case the borrow exists for.
 *
 * It happens only while nothing here is `settled` — see `importKeys.ts` for what that means and
 * why a key cleared here is therefore never borrowed straight back.
 */
export function loadConfig(): StampedConfig {
  if (typeof window === 'undefined') {
    return { config: normalizeConfig(null), updatedAt: 0, borrowed: false, settled: false };
  }

  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) {
      const { config, borrowed } = borrowFromBrowser();
      return { config, updatedAt: 0, borrowed, settled: false };
    }

    const parsed = JSON.parse(raw);
    const config = normalizeConfig(parsed);
    const settled = parsed?.settled === true;

    // A config this browser holds but nobody has decided — the shape left behind by pulling an
    // empty account document. It is still a first visit as far as the borrow is concerned.
    if (shouldBorrow(config, settled)) {
      const keys = sloperKeysInBrowser();
      if (anyKey(keys)) {
        return {
          config: configWithBorrowedKeys(config, keys),
          // Stamped 0 like any other borrow, so the account still wins. See above.
          updatedAt: 0,
          borrowed: true,
          settled: false,
        };
      }
    }

    return {
      config,
      updatedAt: typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : 0,
      borrowed: false,
      settled,
    };
  } catch (e) {
    // A corrupt value is worth one line: it is the difference between "my key vanished" and "my
    // key vanished and nobody can say why".
    log.warn('backseat.config.load.failed', describeError(e));
    return { config: normalizeConfig(null), updatedAt: 0, borrowed: false, settled: false };
  }
}

export function saveConfig(config: BackseatConfig, updatedAt: number, settled: boolean): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...config, updatedAt, settled }));
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
