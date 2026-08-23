import { describe, expect, it } from 'vitest';
import { canArm, isArmed, pushUiState, type PushInputs, type PushUiState } from './pushState';

const base: PushInputs = {
  supported: true,
  installed: true,
  requiresInstall: false,
  permission: 'default',
  hasSubscription: false,
  savedAt: null,
  busy: false,
};

const at = (over: Partial<PushInputs>) => pushUiState({ ...base, ...over });

describe('pushUiState', () => {
  it('reports unsupported before anything else', () => {
    expect(at({ supported: false })).toBe('unsupported');
    expect(at({ permission: null })).toBe('unsupported');
  });

  it('puts the install gate ahead of permission on a platform that needs it', () => {
    // On iOS in a Safari tab there is nothing useful to say about permission: the prompt cannot
    // appear and subscribe would fail. Anything else here offers a button that silently does
    // nothing, which looks exactly like a bug in the app.
    expect(at({ requiresInstall: true, installed: false })).toBe('needs-install');
    expect(at({ requiresInstall: true, installed: false, permission: 'granted' })).toBe('needs-install');
    expect(at({ requiresInstall: true, installed: false, permission: 'denied' })).toBe('needs-install');
    expect(at({ requiresInstall: true, installed: false, busy: true })).toBe('needs-install');
  });

  it('does not gate a desktop tab on being installed', () => {
    // A tab is a perfectly good place to receive notifications everywhere except iOS.
    expect(at({ requiresInstall: false, installed: false })).toBe('prompt');
  });

  it('reports a denial as final', () => {
    expect(at({ permission: 'denied' })).toBe('blocked');
    // Even mid-request: there is nothing in flight worth reporting once the answer is no.
    expect(at({ permission: 'denied', busy: true })).toBe('blocked');
  });

  it('distinguishes granted-but-unsubscribed from ready', () => {
    // The state everybody forgets. It is what iOS leaves behind when it drops a subscription
    // weeks later without firing any event, and it must not read as "notifications are on".
    expect(at({ permission: 'granted', hasSubscription: false })).toBe('granted-no-sub');
    expect(at({ permission: 'granted', hasSubscription: true, savedAt: null })).toBe('unsaved');
    expect(at({ permission: 'granted', hasSubscription: true, savedAt: 1 })).toBe('ready');
  });

  it('is total over every combination of its inputs', () => {
    const valid: PushUiState[] = [
      'unsupported', 'needs-install', 'blocked', 'prompt',
      'arming', 'granted-no-sub', 'unsaved', 'ready',
    ];
    const bools = [true, false];
    const permissions: PushInputs['permission'][] = ['default', 'granted', 'denied', null];
    let count = 0;
    for (const supported of bools)
      for (const installed of bools)
        for (const requiresInstall of bools)
          for (const permission of permissions)
            for (const hasSubscription of bools)
              for (const savedAt of [null, 1])
                for (const busy of bools) {
                  const state = pushUiState({
                    supported, installed, requiresInstall, permission,
                    hasSubscription, savedAt, busy,
                  });
                  expect(valid).toContain(state);
                  count += 1;
                }
    expect(count).toBe(2 * 2 * 2 * 4 * 2 * 2 * 2);
  });
});

describe('canArm / isArmed', () => {
  it('offers the button only where a prompt can actually appear', () => {
    expect(canArm('prompt')).toBe(true);
    // A page cannot undo a denial, and a button that appears to try is worse than a sentence
    // saying where the setting lives.
    expect(canArm('blocked')).toBe(false);
    expect(canArm('needs-install')).toBe(false);
    expect(canArm('ready')).toBe(false);
  });

  it('calls only ready armed', () => {
    expect(isArmed('ready')).toBe(true);
    expect(isArmed('unsaved')).toBe(false);
    expect(isArmed('granted-no-sub')).toBe(false);
  });
});
