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

import { reserveDiesel, settleDiesel, topUpDiesel, walletStatus } from './wallet';

beforeEach(() => store.clear());

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

  it('settles at what it cost, never more than reserved, and keeps all of an unknown price', async () => {
    await reserveDiesel('u1', 0.2);
    await settleDiesel('u1', 0.2, 0.05);
    expect(store.get('rpgLedger/u1')?.dieselUsd).toBeCloseTo(0.95);
    await reserveDiesel('u1', 0.1);
    await settleDiesel('u1', 0.1, 0.5);
    expect(store.get('rpgLedger/u1')?.dieselUsd).toBeCloseTo(0.85);
    await reserveDiesel('u1', 0.1);
    await settleDiesel('u1', 0.1, null);
    expect(store.get('rpgLedger/u1')?.dieselUsd).toBeCloseTo(0.75);
    expect(store.get('rpgLedger/u1')?.dieselSpentUsd).toBeCloseTo(0.25);
  });

  it('tops up on top of the first tank', async () => {
    expect(await topUpDiesel('u9', 2)).toBe(3);
    expect(await topUpDiesel('u9', 1)).toBe(4);
  });
});
