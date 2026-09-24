/*
 * The small pieces the audio guide's load-time measurements share. The measurements themselves are
 * sent from where the waiting happens - `useNearbyAttractions` for the pins, `useAudioGuide` for a
 * narration, `useUserPosition` for the first fix - through `recordMeasurement` in `lib/sentry.ts`.
 * See "Every wait is measured" in `.claude/rules/audio-guide.md` for what each one carries and how
 * to read them back.
 */

/**
 * The browser's guess at the connection - `4g`, `3g`, `slow-2g` - where it offers one. Chrome and
 * Android do; Safari and Firefox do not, so an absent value says "iPhone, probably", not "offline".
 */
export function networkType(): string | undefined {
  try {
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string } })
      .connection;
    return connection?.effectiveType || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The function's Server-Timing header, as `{ facts: 6120, total: 21400, cold: 0 }`.
 *
 * Only what the function writes is expected - `name;dur=123` entries and a bare `cold` on an
 * instance's first request - but anything else parses harmlessly or is skipped. Names are prefixed
 * `server` + capitalised by the caller, so they cannot collide with the page's own fields.
 */
export function parseServerTiming(header: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!header) return out;
  for (const entry of header.split(',')) {
    const [rawName, ...params] = entry.split(';').map((p) => p.trim());
    if (!rawName || !/^[a-z][a-z0-9_-]*$/i.test(rawName)) continue;
    const dur = params.find((p) => p.startsWith('dur='));
    if (!dur) {
      out[rawName] = 1; // a flag: present means true
      continue;
    }
    const value = Number(dur.slice(4));
    if (Number.isFinite(value)) out[rawName] = Math.round(value);
  }
  return out;
}
