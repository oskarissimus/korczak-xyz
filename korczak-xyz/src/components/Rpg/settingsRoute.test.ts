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
