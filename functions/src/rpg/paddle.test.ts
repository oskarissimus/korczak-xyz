import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Paddle's webhook: only a signed body pours, a transaction pours once however often it is delivered,
 * the litres come from the prices, and a refund takes its share back without going below empty.
 */

const store = new Map<string, Record<string, unknown>>();

function apply(path: string, data: Record<string, unknown>, merge = true) {
  const next = merge ? { ...(store.get(path) ?? {}) } : {};
  for (const [k, v] of Object.entries(data)) {
    const inc = (v as { __inc?: number })?.__inc;
    next[k] = typeof inc === 'number' ? ((next[k] as number) ?? 0) + inc : v;
  }
  store.set(path, next);
}

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n: number) => ({ __inc: n }) } }));
vi.mock('./admin', () => ({ readServerKeys: async () => ({}) }));
const reported: string[] = [];
vi.mock('../sentry', () => ({ reportError: (where: string) => reported.push(where) }));
vi.mock('../runtime', () => {
  const ref = (path: string) => ({
    path,
    get: async () => ({ data: () => store.get(path), exists: store.has(path) }),
    set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => apply(path, data, Boolean(opts?.merge)),
  });
  return {
    db: {
      collection: (c: string) => ({ doc: (d: string) => ref(`${c}/${d}`) }),
      doc: (p: string) => ref(p),
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          get: (r: { get: () => unknown }) => r.get(),
          set: (r: { path: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) => apply(r.path, data, Boolean(opts?.merge)),
        }),
    },
  };
});

import { handlePaddleWebhook, verifySignature } from './paddle';

const SECRET = 'pdl_ntfset_test_secret';

function sign(body: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  return `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;
}

function paid(txn = 'txn_1', uid: string | null = 'u1', litres = 250, type = 'transaction.completed') {
  return JSON.stringify({
    event_id: `evt_${txn}`,
    event_type: type,
    data: {
      id: txn,
      currency_code: 'PLN',
      custom_data: uid ? { uid } : null,
      items: [{ quantity: 1, price: { id: 'pri_can', custom_data: { pack: 'can', litres } } }],
      details: { totals: { grand_total: '2000' } },
    },
  });
}

async function deliver(body: string, signature: string | null = sign(body)) {
  let status = 0;
  let json: unknown = null;
  const res = {
    headersSent: false,
    status(s: number) {
      status = s;
      return this;
    },
    json(j: unknown) {
      json = j;
      return this;
    },
  };
  await handlePaddleWebhook({ method: 'POST', headers: signature ? { 'paddle-signature': signature } : {} } as never, res as never, Buffer.from(body));
  return { status, json: json as { outcome?: string } };
}

beforeEach(() => {
  store.clear();
  reported.length = 0;
  store.set('rpgPaddle/config', { webhookSecret: SECRET });
  store.set('rpgDiesel/config', { grantUsd: 1 });
});

describe('the Paddle webhook', () => {
  it('checks the signature, its age and the secret', () => {
    const body = Buffer.from('{"a":1}');
    expect(verifySignature(body, sign('{"a":1}'), [SECRET])).toBe(true);
    expect(verifySignature(body, sign('{"a":1}'), ['other', SECRET])).toBe(true);
    expect(verifySignature(body, sign('{"a":2}'), [SECRET])).toBe(false);
    expect(verifySignature(body, sign('{"a":1}', 'wrong'), [SECRET])).toBe(false);
    expect(verifySignature(body, sign('{"a":1}', SECRET, Math.floor(Date.now() / 1000) - 3600), [SECRET])).toBe(false);
    expect(verifySignature(body, undefined, [SECRET])).toBe(false);
    expect(verifySignature(body, sign('{"a":1}'), [])).toBe(false);
  });

  it('refuses an unsigned body and pours nothing', async () => {
    expect((await deliver(paid(), null)).status).toBe(401);
    expect((await deliver(paid(), sign(paid(), 'forged'))).status).toBe(401);
    expect(store.get('rpgLedger/u1')).toBeUndefined();
  });

  it('pours the price’s litres once, on paid or completed, whichever comes first', async () => {
    store.set('rpgLedger/u1', { dieselUsd: 0.5, dieselGrantedAt: 1 });
    expect((await deliver(paid('txn_1', 'u1', 250, 'transaction.paid'))).json.outcome).toBe('credited');
    expect((await deliver(paid('txn_1'))).json.outcome).toBe('duplicate');
    expect((await deliver(paid('txn_1'))).json.outcome).toBe('duplicate');
    expect(store.get('rpgLedger/u1')?.dieselUsd).toBeCloseTo(3);
    expect(store.get('rpgPurchases/txn_1')).toMatchObject({ uid: 'u1', litres: 250, status: 'credited', totalMinor: '2000' });
  });

  it('grants a new account its first tank as well as what it bought', async () => {
    await deliver(paid('txn_2', 'fresh', 1400));
    expect(store.get('rpgLedger/fresh')?.dieselUsd).toBeCloseTo(15);
  });

  it('keeps a paid transaction with no account as an orphan, reports it, and still answers 200', async () => {
    const r = await deliver(paid('txn_3', null));
    expect(r.status).toBe(200);
    expect(r.json.outcome).toBe('orphan');
    expect(store.get('rpgPurchases/txn_3')?.status).toBe('orphan');
    expect(reported).toContain('rpgApi.paddle.orphan');
  });

  it('takes a refund’s share back once, never below an empty tank', async () => {
    store.set('rpgLedger/u1', { dieselUsd: 0, dieselGrantedAt: 1 });
    await deliver(paid('txn_4', 'u1', 550));
    const refund = (status: string, total: string) =>
      JSON.stringify({ event_type: 'adjustment.updated', data: { id: 'adj_1', action: 'refund', status, transaction_id: 'txn_4', totals: { total } } });
    expect((await deliver(refund('pending_approval', '1000'))).json.outcome).toBe('ignored');
    expect((await deliver(refund('approved', '1000'))).json.outcome).toBe('debited');
    expect(store.get('rpgLedger/u1')?.dieselUsd).toBeCloseTo(5.5 - 2.75);
    expect((await deliver(refund('approved', '1000'))).json.outcome).toBe('duplicate');
    store.set('rpgLedger/u1', { ...store.get('rpgLedger/u1'), dieselUsd: 1 });
    const full = JSON.stringify({ event_type: 'adjustment.created', data: { id: 'adj_2', action: 'chargeback', status: 'approved', transaction_id: 'txn_4', totals: { total: '2000' } } });
    await deliver(full);
    expect(store.get('rpgLedger/u1')?.dieselUsd).toBe(0);
  });

  it('ignores events it has nothing to do with', async () => {
    expect((await deliver(JSON.stringify({ event_type: 'customer.created', data: {} }))).json.outcome).toBe('ignored');
  });
});
