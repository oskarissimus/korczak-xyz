import { describe, expect, it } from 'vitest';
import { eventFocusOf, eventLink, FEED_PATH, localizePath } from './links';
import { fingerprintOf } from './normalize';

/*
 * The two ends of one string: the Cloud Function writes the link and the feed reads it back. They
 * are tested together because that is the only property that matters — a change to either spelling
 * that does not survive the round trip is a notification that opens the feed's first screen again,
 * which is the bug this module exists to fix and which nothing else would notice.
 */
describe('the deep link round trip', () => {
  it('carries a real fingerprint through unharmed', () => {
    const fingerprint = fingerprintOf({
      title: 'Wesele Figara — premiera',
      day: '2026-10-04',
      city: 'Warszawa',
    });
    expect(eventFocusOf(new URL(eventLink(fingerprint), 'https://korczak.xyz').search)).toBe(
      fingerprint,
    );
  });

  /*
   * A fingerprint is `title|day|city`, and `|` in a query string is exactly the sort of character
   * that survives until the day a proxy or an OS notification centre decides it does not.
   */
  it('escapes the separator rather than trusting it', () => {
    expect(eventLink('wesele|2026-10-04|warszawa')).toBe(
      '/apps/events/?event=wesele%7C2026-10-04%7Cwarszawa',
    );
  });

  it('opens the feed itself when there is no fingerprint to name', () => {
    expect(eventLink('')).toBe(FEED_PATH);
    expect(eventLink('   ')).toBe(FEED_PATH);
  });

  it('reads an ordinary visit as no focus at all', () => {
    expect(eventFocusOf('')).toBeNull();
    expect(eventFocusOf('?')).toBeNull();
    expect(eventFocusOf('?event=')).toBeNull();
    expect(eventFocusOf('?tab=feed')).toBeNull();
  });

  it('reads the parameter beside others, and with or without the question mark', () => {
    expect(eventFocusOf('?from=push&event=abc')).toBe('abc');
    expect(eventFocusOf('event=abc')).toBe('abc');
  });
});

/*
 * `/apps/events` and `/pl/apps/events` are two installed apps with two manifests. A Polish home
 * screen handed the English path does not merely read English — the tap lands outside that app's
 * scope, so iOS opens Safari next to it instead of the app the notification came from.
 */
describe('localizePath', () => {
  it('leaves the English path alone', () => {
    expect(localizePath('/apps/events/?event=abc', 'en')).toBe('/apps/events/?event=abc');
  });

  it('moves a Polish subscriber into their own install, query and all', () => {
    expect(localizePath('/apps/events/?event=abc', 'pl')).toBe('/pl/apps/events/?event=abc');
    expect(localizePath('/apps/events/alerts', 'pl')).toBe('/pl/apps/events/alerts');
  });

  it('does not prefix a path that is already Polish', () => {
    expect(localizePath('/pl/apps/events/', 'pl')).toBe('/pl/apps/events/');
    expect(localizePath('/pl', 'pl')).toBe('/pl');
  });

  /*
   * `/plan`, not `/pl` + `/an`. The guard is a segment boundary rather than a prefix for the same
   * reason `scopeKeyOf` in the worker uses one.
   */
  it('reads /pl as a segment, not as three characters', () => {
    expect(localizePath('/plan/something', 'pl')).toBe('/pl/plan/something');
  });
});
