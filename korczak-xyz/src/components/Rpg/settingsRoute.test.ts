import { describe, expect, it } from 'vitest';

import { parseSettingsHash, settingsHash } from './settingsRoute';

describe('settingsRoute', () => {
  it('reads nothing from a hash that is not Settings', () => {
    expect(parseSettingsHash('')).toBeNull();
    expect(parseSettingsHash('#costs')).toBeNull();
    expect(parseSettingsHash('#settingsx/game')).toBeNull();
  });

  it('opens Game for a bare or unknown tab, and keys for an unknown admin tab', () => {
    expect(parseSettingsHash('#settings')).toEqual({ tab: 'game', admin: 'keys' });
    expect(parseSettingsHash('#settings/nope')).toEqual({ tab: 'game', admin: 'keys' });
    expect(parseSettingsHash('#settings/admin/nope')).toEqual({ tab: 'admin', admin: 'keys' });
  });

  it('round-trips every tab, the admin sub-tab only on the admin tab', () => {
    expect(parseSettingsHash('#settings/admin/costs')).toEqual({ tab: 'admin', admin: 'costs' });
    expect(settingsHash({ tab: 'admin', admin: 'costs' })).toBe('#settings/admin/costs');
    expect(settingsHash({ tab: 'story', admin: 'costs' })).toBe('#settings/story');
    expect(parseSettingsHash(settingsHash({ tab: 'controls', admin: 'keys' }))).toEqual({ tab: 'controls', admin: 'keys' });
  });
});

describe('gameRoute', () => {
  it('names every screen and round-trips it', async () => {
    const { parseGameHash, gameHash } = await import('./settingsRoute');
    for (const h of ['#worlds', '#worlds/trash', '#language', '#diesel', '#settings/story', '#settings/admin/costs', '#world/wmvsih7dt0'])
      expect(gameHash(parseGameHash(h))).toBe(h);
    expect(parseGameHash('')).toEqual({ kind: 'home' });
    expect(parseGameHash('#nope')).toEqual({ kind: 'home' });
    expect(parseGameHash('#world/')).toEqual({ kind: 'home' });
    expect(parseGameHash('#world/<script>')).toEqual({ kind: 'home' });
    expect(parseGameHash('#world/abc')).toEqual({ kind: 'world', id: 'abc' });
  });

  it('tells a tab change from a screen change', async () => {
    const { sameScreen } = await import('./settingsRoute');
    expect(sameScreen('#settings/game', '#settings/admin/costs')).toBe(true);
    expect(sameScreen('#world/a', '#world/b')).toBe(true);
    expect(sameScreen('#settings/game', '#diesel')).toBe(false);
    expect(sameScreen('', '#diesel')).toBe(false);
  });
});

describe('splitPath', () => {
  it('finds the game page and the route after it on both hosts', async () => {
    const { splitPath } = await import('./settingsRoute');
    expect(splitPath('/')).toEqual({ base: '/', route: '' });
    expect(splitPath('/pl/')).toEqual({ base: '/pl/', route: '' });
    expect(splitPath('/apps/rpg/')).toEqual({ base: '/apps/rpg/', route: '' });
    expect(splitPath('/apps/rpg')).toEqual({ base: '/apps/rpg/', route: '' });
    expect(splitPath('/settings/story')).toEqual({ base: '/', route: '#settings/story' });
    expect(splitPath('/pl/settings/admin/costs/')).toEqual({ base: '/pl/', route: '#settings/admin/costs' });
    expect(splitPath('/apps/rpg/worlds/trash')).toEqual({ base: '/apps/rpg/', route: '#worlds/trash' });
    expect(splitPath('/pl/apps/rpg/world/k3x9')).toEqual({ base: '/pl/apps/rpg/', route: '#world/k3x9' });
    expect(splitPath('/diesel')).toEqual({ base: '/', route: '#diesel' });
  });
  it('leaves a path that is not a route alone', async () => {
    const { splitPath } = await import('./settingsRoute');
    expect(splitPath('/world/Bad Id!')).toEqual({ base: '/world/Bad Id!/', route: '' });
    expect(splitPath('/worlds/nope')).toEqual({ base: '/worlds/nope/', route: '' });
  });
});
