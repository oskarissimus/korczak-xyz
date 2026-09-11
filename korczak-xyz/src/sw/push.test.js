import { describe, expect, it } from 'vitest';
import {
  notificationOptions,
  parsePushPayload,
  pickClientToFocus,
  pushIconFor,
  PUSH_FALLBACK_TITLE,
  sameOriginPath,
  scopeKeyOf,
} from './push';
import { appForPath } from '../utils/pwa/scope';
import { eventFocusOf, eventLink } from '../utils/events/links';

describe('parsePushPayload is total', () => {
  /*
   * The invariant, stated as a property: iOS revokes the subscription if a push event shows no
   * notification, so there is no input for which the answer is "nothing to show". Every case below
   * is something a real deploy can produce — a truncated payload, a build with a different schema,
   * an empty keepalive.
   */
  const inputs = [
    ['empty string', ''],
    ['undefined-ish', undefined],
    ['null literal', 'null'],
    ['truncated json', '{"title":"Sal'],
    ['not json at all', 'hello'],
    ['empty object', '{}'],
    ['array', '[1,2,3]'],
    ['unknown schema', '{"headline":"x","deck":"y"}'],
    ['blank title', '{"title":"   ","body":"   "}'],
    ['nested nulls', '{"notification":null}'],
  ];

  it.each(inputs)('%s still yields a showable notification', (_label, raw) => {
    const payload = parsePushPayload(raw);
    expect(payload.title.length).toBeGreaterThan(0);
    expect(payload.body.length).toBeGreaterThan(0);
    expect(payload.url.startsWith('/')).toBe(true);
    expect(payload.tag.length).toBeGreaterThan(0);
  });

  it('falls back to a name, not to an empty string', () => {
    expect(parsePushPayload('').title).toBe(PUSH_FALLBACK_TITLE);
  });
});

describe('parsePushPayload reads both envelopes', () => {
  it('reads our flat shape', () => {
    const p = parsePushPayload(
      JSON.stringify({ title: 'Salome', body: 'Premiere 22 Nov', url: '/apps/events', tag: 'x|announced' }),
    );
    expect(p).toMatchObject({ title: 'Salome', body: 'Premiere 22 Nov', url: '/apps/events', tag: 'x|announced' });
  });

  it('reads the Declarative Web Push envelope, which the sender emits alongside', () => {
    // On Safari 18.4+ the OS renders `notification` itself and STILL dispatches the push event.
    // Reading the same fields is what keeps the two banners identical rather than doubled.
    const p = parsePushPayload(
      JSON.stringify({
        web_push: 8030,
        notification: { title: 'Salome', body: 'Premiere', navigate: '/apps/events', tag: 't' },
      }),
    );
    expect(p).toMatchObject({ title: 'Salome', body: 'Premiere', url: '/apps/events', tag: 't' });
  });

  it('clamps a pathological title instead of overflowing the banner', () => {
    const p = parsePushPayload(JSON.stringify({ title: 'x'.repeat(400) }));
    expect(p.title.length).toBeLessThanOrEqual(120);
  });
});

describe('sameOriginPath', () => {
  it('refuses to send a tap off-origin', () => {
    // The payload is the one input to the worker that did not come from our own page.
    expect(sameOriginPath('https://evil.test/steal')).toBe('/apps/events');
    expect(sameOriginPath('//evil.test/steal')).toBe('/apps/events');
    expect(sameOriginPath('javascript:alert(1)')).toBe('/apps/events');
  });

  it('keeps our own absolute URLs as paths', () => {
    expect(sameOriginPath('https://korczak.xyz/pl/apps/events/alerts')).toBe('/pl/apps/events/alerts');
  });

  it('normalises a bare path', () => {
    expect(sameOriginPath('apps/events')).toBe('/apps/events');
    expect(sameOriginPath('/apps/events')).toBe('/apps/events');
  });

  /*
   * A notification names one event in its query string, and this function is the only thing between
   * the sender and the tap. Dropping the query would put every tap back on the feed's first screen
   * — the bug that looks exactly like the feature working, since the right app still opens.
   */
  it('keeps the event a notification was about', () => {
    const link = eventLink('wesele|2026-10-04|warszawa');
    expect(eventFocusOf(new URL(sameOriginPath(link), 'https://korczak.xyz').search)).toBe(
      'wesele|2026-10-04|warszawa',
    );
    expect(sameOriginPath(`https://korczak.xyz${link}`)).toBe(link);
  });

  it('drops the query along with the host when the payload points elsewhere', () => {
    expect(sameOriginPath('https://evil.test/apps/events/?event=abc')).toBe('/apps/events');
  });
});

describe('scopeKeyOf', () => {
  it('claims an app subtree at two segments and everything else at one', () => {
    expect(scopeKeyOf('/apps/events/alerts')).toBe('/apps/events');
    expect(scopeKeyOf('/apps/baby-sleep/stats')).toBe('/apps/baby-sleep');
    expect(scopeKeyOf('/songs/mother')).toBe('/songs');
    expect(scopeKeyOf('/')).toBe('/');
  });

  it('treats a locale as part of the identity', () => {
    // /songs and /pl/songs are separate installable apps, so they are separate scopes.
    expect(scopeKeyOf('/pl/apps/events')).toBe('/pl/apps/events');
    expect(scopeKeyOf('/pl/apps/events')).not.toBe(scopeKeyOf('/apps/events'));
  });

  it('agrees with appForPath about what belongs together', () => {
    /*
     * A behavioural cross-check rather than a text match: scopeKeyOf deliberately does not name the
     * apps, so it cannot become a fourth copy of the fact scope.ts, generate-sw.mjs and
     * register-sw.js already state three times. What must hold is that two paths land in one scope
     * exactly when they land in one app — which is what stops click routing rotting when a seventh
     * app arrives.
     */
    const paths = [
      '/apps/events', '/apps/events/alerts', '/apps/events/interests',
      '/apps/baby-sleep', '/apps/baby-sleep/stats',
      '/apps/flashcards', '/apps/flashcards/neck',
      '/apps/tuner', '/songs', '/songs/mother',
    ];
    for (const a of paths) {
      for (const b of paths) {
        const sameApp = appForPath(a) === appForPath(b);
        const sameScope = scopeKeyOf(a) === scopeKeyOf(b);
        expect(sameScope, `${a} vs ${b}`).toBe(sameApp);
      }
    }
  });
});

describe('pickClientToFocus', () => {
  const target = '/apps/events/alerts';

  it('prefers an exact match', () => {
    expect(pickClientToFocus(['/songs', '/apps/events/alerts', '/apps/events'], target)).toBe(1);
  });

  it('falls back to any window in the same app', () => {
    expect(pickClientToFocus(['/songs', '/apps/events'], target)).toBe(0 + 1);
  });

  it('never focuses a window belonging to a DIFFERENT installed app', () => {
    // All the installed apps share one registration on iOS, so matchAll returns the songbook's
    // window too. Focusing it would look like the tap opened the wrong thing.
    expect(pickClientToFocus(['/songs/mother', '/apps/baby-sleep'], target)).toBeNull();
  });

  it('returns null for nothing open', () => {
    expect(pickClientToFocus([], target)).toBeNull();
    expect(pickClientToFocus(null, target)).toBeNull();
  });

  it('ignores a trailing slash and absolute form', () => {
    expect(pickClientToFocus(['https://korczak.xyz/apps/events/alerts/'], target)).toBe(0);
  });

  it('does not treat the pl app as the en one', () => {
    expect(pickClientToFocus(['/pl/apps/events'], target)).toBeNull();
  });

  /*
   * A deep link differs from the tab already open only in its query, and `notificationclick`
   * navigates whatever it focuses — so this has to find that window rather than open a second copy
   * of the app beside it.
   */
  it('focuses the open feed for a link to one event in it', () => {
    const link = eventLink('wesele|2026-10-04|warszawa');
    expect(pickClientToFocus(['/songs', 'https://korczak.xyz/apps/events/'], link)).toBe(1);
    expect(pickClientToFocus(['/apps/events/interests'], link)).toBe(0);
  });
});

describe('notificationOptions', () => {
  it('carries the path and kind through to the click handler', () => {
    const options = notificationOptions(parsePushPayload('{"url":"/apps/events","kind":"onsale"}'));
    expect(options.data).toEqual({ url: '/apps/events', kind: 'onsale' });
  });

  it('renotifies, so a soon reminder replacing an announcement still buzzes', () => {
    expect(notificationOptions(parsePushPayload('{}')).renotify).toBe(true);
  });

  /*
   * One worker draws for two apps, and it drew Event Watch's ticket on a metro closure until this
   * was derived from the target path. iOS overrides it with the installed app's own icon, which is
   * why nothing on a phone ever showed the mismatch — a desktop browser shows exactly this.
   */
  it('wears the icon of the app the tap opens', () => {
    const transit = notificationOptions(parsePushPayload('{"url":"/apps/transit/raw"}'));
    expect(transit.icon).toBe('/icons/transit-192.png');
    expect(transit.badge).toBe(transit.icon);

    expect(notificationOptions(parsePushPayload('{"url":"/apps/events/alerts"}')).icon).toBe(
      '/icons/events-192.png',
    );
  });

  it.each([
    ['/apps/transit', '/icons/transit-192.png'],
    ['/pl/apps/transit/alerts', '/icons/transit-192.png'],
    ['/apps/events', '/icons/events-192.png'],
    ['/pl/apps/events/alerts', '/icons/events-192.png'],
    // Anything else is the events app's, which is where the fallback URL points too.
    ['/songs', '/icons/events-192.png'],
    ['', '/icons/events-192.png'],
    [undefined, '/icons/events-192.png'],
  ])('pushIconFor(%s)', (url, icon) => {
    expect(pushIconFor(url)).toBe(icon);
  });
});
