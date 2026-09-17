/*
 * The config, in this browser.
 *
 * One key, one small JSON object, no history — which is the whole reason this file is short
 * where `utils/typing/storage.ts` is long. Nothing sloper produces during a sitting is written
 * here: scenes are a few kilobytes but the assets they hang off are megabytes of image and audio
 * `Blob`, and the origin's ~5 MB is shared with the typing trainer's `typedHistory` and the
 * quiz. One sitting's assets would evict a book. So a sitting lives and dies in memory, and the
 * only thing that survives a reload is what you typed into the settings.
 *
 * `updatedAt` rides along with it, and it is the entire conflict resolution between this browser
 * and the account — see cloud.ts. It is a client clock, which is exactly as trustworthy as it
 * sounds; what it is being asked to settle is "which of my own two devices did I last type a key
 * on", where being a few minutes out costs nothing.
 *
 * The keys themselves are in here, in the clear, as they were in sloper. That is not an
 * oversight and it is not fixable by encrypting them: anything the page can decrypt to call
 * OpenAI with, script running on this origin can decrypt too. What it means in practice is in
 * `.claude/rules/sloper.md` — the short version is that these are metered keys the owner can
 * revoke, and the alternative (a server of ours holding them) is a bigger thing to own.
 */

import { isQuotaError } from '../../lib/localStorage';
import { describeError, log } from '../../lib/logger';
import { normalizeConfig } from './defaults';
import type { SloperConfig } from './types';

export const CONFIG_KEY = 'sloper-config';

/**
 * sloper's own key on GitHub Pages. A different origin, so nothing can actually be inherited
 * from it — the name is read as a fallback rather than reused, so that a browser which somehow
 * carries one finds it, and so a future "import the old app's settings" has one thing to look for.
 */
export const LEGACY_CONFIG_KEY = 'sloper-api-config';

export interface StampedConfig {
  config: SloperConfig;
  /** When this copy was last edited, by whichever device edited it. 0 means "never". */
  updatedAt: number;
}

export function loadConfig(): StampedConfig {
  if (typeof window === 'undefined') return { config: normalizeConfig(null), updatedAt: 0 };

  try {
    const raw = localStorage.getItem(CONFIG_KEY) ?? localStorage.getItem(LEGACY_CONFIG_KEY);
    if (!raw) return { config: normalizeConfig(null), updatedAt: 0 };

    const parsed = JSON.parse(raw);
    return {
      config: normalizeConfig(parsed),
      updatedAt: typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch (e) {
    // A corrupt value is worth one line: it is the difference between "the settings reset" and
    // "the settings reset and nobody can say why".
    log.warn('sloper.config.load.failed', describeError(e));
    return { config: normalizeConfig(null), updatedAt: 0 };
  }
}

export function saveConfig(config: SloperConfig, updatedAt: number): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...config, updatedAt }));
  } catch (e) {
    // Nothing to evict — this app owns one key and it is already the smallest it can be. The
    // report is the point: a silent failure here is what makes a key "not stick" after a reload.
    log.warn(
      isQuotaError(e) ? 'sloper.config.save.full' : 'sloper.config.save.failed',
      describeError(e),
    );
  }
}

export function clearConfig(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(LEGACY_CONFIG_KEY);
  } catch {
    // Removing a key that cannot be removed leaves the defaults in memory, which is what the
    // caller asked for. Nothing to report and nothing to do.
  }
}
