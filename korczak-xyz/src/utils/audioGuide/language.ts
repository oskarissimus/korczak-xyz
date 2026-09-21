/*
 * The language the narration is written and read in.
 *
 * It is not the language the page is in, and conflating the two would be wrong in both
 * directions: somebody reading the Polish site in Kraków may well want the guide in English for a
 * visitor beside them, and somebody reading the English site in Warsaw may want Polish. So it is
 * its own setting, with the page's language only as the default the first time.
 *
 * Free text, not a code list. It goes into a prompt - the model is told to write in it - so any
 * language it can name is a language it can honour, and a dropdown of two would be a shorter list
 * than the model's own. The two on the list are the two the site is in; everything else is typed.
 */

import { isQuotaError } from '../../lib/localStorage';
import { describeError, log } from '../../lib/logger';

export const LANGUAGE_KEY = 'audioGuideLanguage';

/** The named ones, which are the site's own two. Everything else arrives through "Other". */
export const PRESET_LANGUAGES = ['English', 'Polski'] as const;

export function defaultLanguage(lang: 'en' | 'pl'): string {
  return lang === 'pl' ? 'Polski' : 'English';
}

/**
 * The stored language, or the page's own.
 *
 * Trimmed and length-capped on the way out as well as in: the value is a prompt fragment, and the
 * backend rejects anything past fifty characters outright, which would turn a stale localStorage
 * value from a previous version into an app that fails on every tap with nothing to say why.
 */
export function loadLanguage(lang: 'en' | 'pl'): string {
  if (typeof window === 'undefined') return defaultLanguage(lang);
  try {
    const raw = localStorage.getItem(LANGUAGE_KEY);
    return normalizeLanguage(raw) ?? defaultLanguage(lang);
  } catch (e) {
    log.warn('audioGuide.language.load.failed', describeError(e));
    return defaultLanguage(lang);
  }
}

export function saveLanguage(value: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LANGUAGE_KEY, value);
  } catch (e) {
    // One key of at most fifty characters. If this fails the origin is full of something else -
    // the typing trainer's history is the usual culprit - and the setting silently not sticking
    // is exactly the kind of thing nobody can explain later.
    log.warn(
      isQuotaError(e) ? 'audioGuide.language.save.full' : 'audioGuide.language.save.failed',
      describeError(e),
    );
  }
}

export const MAX_LANGUAGE_LENGTH = 50;

/** Trim, cap, and refuse an empty string. Null means "there was nothing usable here". */
export function normalizeLanguage(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_LANGUAGE_LENGTH);
}

export function isPreset(value: string): boolean {
  return (PRESET_LANGUAGES as readonly string[]).includes(value);
}
