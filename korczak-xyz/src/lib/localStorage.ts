/*
 * The two things every localStorage writer on this origin needs to know: how full the store is,
 * and whether the exception it just caught means "full".
 *
 * Both games share one ~5 MB budget, so neither can answer the first question by looking only at
 * its own keys — which is why `storageBytes` walks the whole store. See the storage-budget note
 * in CLAUDE.md for what happens when nobody checks.
 */

/** Total characters held in localStorage across every key on the origin. */
export function storageBytes(): number {
  if (typeof window === 'undefined') return 0;
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key == null) continue;
      total += key.length + (localStorage.getItem(key)?.length ?? 0);
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Whether a thrown value is the store saying it is full.
 *
 * Browsers disagree on how they say it: the name is standard, the numeric codes are what older
 * Firefox and Safari builds report.
 */
export function isQuotaError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const { name, code } = e as { name?: unknown; code?: unknown };
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}
