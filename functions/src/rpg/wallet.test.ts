import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The diesel tank's transaction: the first tank granted once, a reservation that never takes the
 * balance below zero, and a settlement that spends at most what was reserved.
 */

const store = new Map<string, Record<string, unknown>>();

function apply(path: string, data: Record<string, unknown>) {
  const next = { ...(store.get(path) ?? {}) };
  for (const [k, v] of Object.entries(data)) {
    const inc = (v as { __inc?: number })?.__inc;
    next[k] = typeof inc === 'number' ? ((next[k] as number) ?? 0) + inc : v;
  }
  store.set(path, next);
}

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n: number) => ({ __inc: n }) } }));
vi.mock('./admin', () => ({ readServerKeys: async () => ({ google: 'k', elevenLabs: null, fal: 'f', openai: null }) }));
vi.mock('../runtime', () => {
  const ref = (path: string) => ({
    path,
    get: async () => ({ data: () => store.get(path), exists: store.has(path) }),
    set: async (data: Record<string, unknown>) => apply(path, data),
  });
  return {
    db: {
      collection: (c: string) => ({ doc: (d: string) => ref(`${c}/${d}`) }),
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ get: (r: { get: () => unknown }) => r.get(), set: (r: { path: string }, data: Record<string, unknown>) => apply(r.path, data) }),
    },
  };
});

import { forgetDieselCaches, reserveDiesel, settleDiesel, topUpDiesel, walletStatus } from './wallet';

// The tank these tests pour is the panel's $1, not the default sign-up bonus (`grantOf` tests that).
beforeEach(() => {
  store.clear();
  store.set('rpgDiesel/config', { grantUsd: 1 });
  forgetDieselCaches();
});

describe('the diesel tank', () => {
  it('grants a new account its first tank once, and says which server keys diesel can stand in for', async () => {
    const status = await walletStatus('u1');
    expect(status.balanceUsd).toBe(1);
    expect(status.server).toEqual({ google: true, elevenLabs: false, fal: true, openai: false });
    expect(store.get('rpgLedger/u1')?.dieselUsd).toBe(1);
    // Emptied, it stays empty: the grant is not given again.
    store.set('rpgLedger/u1', { ...store.get('rpgLedger/u1'), dieselUsd: 0 });
    expect((await walletStatus('u1')).balanceUsd).toBe(0);
  });

  it('reserves what fits, refuses what does not, and refuses anything on an empty tank', async () => {
    expect(await reserveDiesel('u1', 0.4)).toEqual({ ok: true, balanceUsd: 0.6 });
    expect(await reserveDiesel('u1', 0.7)).toEqual({ ok: false, balanceUsd: 0.6 });
    store.set('rpgLedger/u1', { ...store.get('rpgLedger/u1'), dieselUsd: 0 });
    expect((await reserveDiesel('u1', 0)).ok).toBe(false);
    expect((await reserveDiesel('u1', 0, true)).ok).toBe(true);
  });

  it('settles at what it cost, an overrun included, and keeps all of an unknown price', async () => {
    await reserveDiesel('u1', 0.2);
    await settleDiesel('u1', 0.2, 0.05);
    expect(store.get('rpgLedger/u1')?.dieselUsd).toBeCloseTo(0.95);
    await reserveDiesel('u1', 0.1);
    await settleDiesel('u1', 0.1, 0.5);
    expect(store.get('rpgLedger/u1')?.dieselUsd).toBeCloseTo(0.45);
    await reserveDiesel('u1', 0.1);
    await settleDiesel('u1', 0.1, null);
    expect(store.get('rpgLedger/u1')?.dieselUsd).toBeCloseTo(0.35);
    expect(store.get('rpgLedger/u1')?.dieselSpentUsd).toBeCloseTo(0.65);
  });

  it('goes below zero on an overrun and then refuses until filled', async () => {
    await reserveDiesel('u1', 0.9);
    await settleDiesel('u1', 0.9, 1.5);
    expect(store.get('rpgLedger/u1')?.dieselUsd).toBeCloseTo(-0.5);
    expect((await reserveDiesel('u1', 0.01)).ok).toBe(false);
    expect((await walletStatus('u1')).balanceUsd).toBe(0);
  });

  it('pours a first tank only so many times a day from one address', async () => {
    for (const uid of ['a', 'b', 'c']) expect((await walletStatus(uid, { ip: '9.9.9.9' })).balanceUsd).toBe(1);
    expect((await walletStatus('d', { ip: '9.9.9.9' })).balanceUsd).toBe(0);
    expect(store.get('rpgLedger/d')).toBeUndefined();
    expect((await reserveDiesel('d', 0.1, false, { ip: '9.9.9.9' })).ok).toBe(false);
    // From another address the grant still comes.
    expect((await walletStatus('d', { ip: '8.8.8.8' })).balanceUsd).toBe(1);
  });

  it('stops every account once the day\'s spend reaches the cap', async () => {
    store.set('rpgDiesel/config', { grantUsd: 1, dailyUsd: 0.5 });
    forgetDieselCaches();
    await reserveDiesel('u1', 0.4);
    await settleDiesel('u1', 0.4, 0.6);
    const r = await reserveDiesel('u2', 0.1);
    expect(r).toMatchObject({ ok: false, reason: 'daily-cap' });
    // A follow-up of work already paid for still goes through.
    expect((await reserveDiesel('u2', 0, true)).ok).toBe(true);
  });

  it('tops up on top of the first tank', async () => {
    expect(await topUpDiesel('u9', 2)).toBe(3);
    expect(await topUpDiesel('u9', 1)).toBe(4);
  });
});
