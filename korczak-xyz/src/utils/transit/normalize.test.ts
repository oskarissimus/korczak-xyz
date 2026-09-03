import { describe, expect, it } from 'vitest';
import { alertIdFor, contentHashOf, parseAlertId, transitIdFor } from './normalize';

describe('ids', () => {
  it('derives a document id from the feed and the permalink, and from nothing else', () => {
    const guid = 'https://www.wtp.waw.pl/utrudnienia/2026/09/03/utrudnienia-w-kursowaniu-linii-metra-m1-66/';
    expect(transitIdFor('impediment', guid)).toBe(transitIdFor('impediment', guid));
    expect(transitIdFor('impediment', guid)).not.toBe(transitIdFor('change', guid));
    expect(transitIdFor('impediment', guid)).not.toContain('/');
  });

  it('round-trips an alert id', () => {
    const id = alertIdFor('https://example.test/a/', 'route', 'deadbeefdeadbeef');
    expect(parseAlertId(id)).toEqual({
      guid: 'https-example-test-a',
      kind: 'route',
      contentHash: 'deadbeefdeadbeef',
    });
  });

  it('refuses an id that is not one', () => {
    expect(parseAlertId('nope')).toBeNull();
    expect(parseAlertId('a|route|')).toBeNull();
  });
});

describe('contentHashOf', () => {
  it('changes when the prose changes', () => {
    expect(contentHashOf({ title: 'a', body: 'x' })).not.toBe(contentHashOf({ title: 'a', body: 'y' }));
    expect(contentHashOf({ title: 'a' })).not.toBe(contentHashOf({ title: 'b' }));
  });

  it('does not change for whitespace, case or diacritics-only churn in the CMS', () => {
    expect(contentHashOf({ title: 'Metro M1', body: 'Stacja  Centrum ' })).toBe(
      contentHashOf({ title: 'metro m1', body: 'Stacja Centrum' }),
    );
  });

  it('is sixteen hex characters, so an alert id stays readable in a console', () => {
    expect(contentHashOf({ title: 'a', body: 'b' })).toMatch(/^[0-9a-f]{16}$/);
  });

  /*
   * A change detector rather than a digest, so the module stays portable — but it still has to be
   * one. Two passes over a few thousand realistic strings must not collide.
   */
  it('does not collide across the shapes this feed actually produces', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i += 1) {
      seen.add(contentHashOf({ title: `Utrudnienia w komunikacji: ${i}`, body: `Stacja nr ${i} zamknięta.` }));
    }
    expect(seen.size).toBe(4000);
  });
});
