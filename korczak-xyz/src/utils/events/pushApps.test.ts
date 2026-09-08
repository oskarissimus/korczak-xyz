import { describe, expect, it } from 'vitest';

import { claimedApps, claimFor, claimsApp, PUSH_APPS, subsForApp } from './pushApps';
import type { PushApp, PushSub } from './types';

function sub(id: string, apps?: PushSub['apps']): PushSub {
  return {
    id,
    endpoint: `https://web.push.apple.com/${id}`,
    p256dh: 'k',
    authKey: 'a',
    lang: 'en',
    ua: 'iPhone',
    createdAt: 0,
    lastSeenAt: 0,
    ...(apps ? { apps } : {}),
  };
}

describe('a subscription belongs to the app that armed it', () => {
  /*
   * The bug this exists for: an iPhone with both apps on its home screen holds one subscription per
   * app — separate storage container, separate registration, separate endpoint — and the app owning
   * the endpoint is the one whose name iOS puts on the banner. Fanning out to every row on the
   * account delivered Event Watch's announcements under Metro Watch's name.
   */
  it('sends each app only to its own endpoints', () => {
    const subs = [sub('events-phone', { events: true }), sub('transit-phone', { transit: true })];

    expect(subsForApp(subs, 'events').map((s) => s.id)).toEqual(['events-phone']);
    expect(subsForApp(subs, 'transit').map((s) => s.id)).toEqual(['transit-phone']);
  });

  /*
   * A desktop browser really does serve both apps from one registration, so one endpoint carries
   * both claims. A map rather than an array is what makes that survive: two tabs merge-writing an
   * array would each overwrite the other's claim, and whichever app was opened last would be the
   * only one that could reach the machine.
   */
  it('lets one endpoint be claimed by both', () => {
    const shared = [sub('laptop', { events: true, transit: true })];

    expect(subsForApp(shared, 'events')).toHaveLength(1);
    expect(subsForApp(shared, 'transit')).toHaveLength(1);
    expect(claimedApps(shared[0])).toEqual(['events', 'transit']);
  });

  /*
   * The migration, and the one direction it is safe to be wrong in. Every row registered before the
   * claim existed carries none, and reading that as "no app may push here" would be a silence
   * nobody can see — where reading it as "both" is exactly the behaviour of the build being
   * replaced, for as long as it takes each app to be opened once.
   */
  it.each([
    ['no field at all', undefined],
    ['an empty map', {}],
    ['every claim false', { events: false, transit: false }],
  ])('treats a row with %s as belonging to every app', (_label, apps) => {
    const row = sub('legacy', apps as PushSub['apps']);
    for (const app of PUSH_APPS) expect(claimsApp(row, app)).toBe(true);
  });

  it('claims exactly the app that wrote it', () => {
    for (const app of PUSH_APPS) {
      expect(claimedApps({ apps: claimFor(app) })).toEqual([app]);
      for (const other of PUSH_APPS) {
        expect(claimsApp({ apps: claimFor(app) }, other)).toBe(app === other);
      }
    }
  });

  it('reports claims in a fixed order whatever order they were written in', () => {
    const backwards: Partial<Record<PushApp, boolean>> = { transit: true, events: true };
    expect(claimedApps({ apps: backwards })).toEqual(['events', 'transit']);
  });
});
