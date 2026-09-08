import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Every fan-out over `pushSubs` has to be filtered to one app.
 *
 * Read as text, in the spirit of `tiers.test.ts` on the site side, because the thing that goes wrong
 * is not a wrong answer from a function anybody wrote — it is a *fourth* place that reads the
 * collection and forgets. That is what happened: `pushSubs` was designed as one row per device, so
 * every read of it sent to every row, and on an iPhone with both apps installed each app owns its
 * own endpoint. Event Watch's announcements arrived under Metro Watch's name and icon, and neither
 * collector was wrong on its own terms.
 *
 * A read of a single row by id is exempt: `sendTestPush` is handed the device to test by the person
 * pressing the button, and that is already an answer to "which endpoint".
 */
const DIR = new URL('./', import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'fixtures' ? [] : sources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

const FAN_OUT = /collection\('pushSubs'\)\s*\.get\(\)/g;

describe('nothing pushes to every endpoint on an account', () => {
  const files = sources(DIR);

  it('has sources to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.slice(DIR.length), f]))('%s', (label, path) => {
    const text = readFileSync(path, 'utf8');
    const reads = text.match(FAN_OUT)?.length ?? 0;
    if (reads === 0) return;

    expect(
      text.includes('subsForApp('),
      `${label} reads the whole pushSubs collection ${reads} time(s) without subsForApp. Two apps ` +
        `register separate endpoints on one account — an iPhone holds one per installed app — so ` +
        `an unfiltered send delivers this app's notifications under the other app's name.`,
    ).toBe(true);
  });
});
