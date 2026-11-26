import { describe, expect, it, vi } from 'vitest';

const docs = new Map<string, Record<string, unknown>>();

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n: number) => ({ __inc: n }) } }));
vi.mock('../runtime', () => ({
  db: {
    collection: (c: string) => ({ doc: (id: string) => ({ path: `${c}/${id}` }) }),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
      fn({
        get: async (ref: { path: string }) => ({ data: () => docs.get(ref.path) }),
        set: (ref: { path: string }, data: { n: { __inc: number } }) => {
          const n = Number(docs.get(ref.path)?.n ?? 0) + data.n.__inc;
          docs.set(ref.path, { n });
        },
      }),
  },
}));

import { takeDaily } from './dailyCap';

describe('takeDaily', () => {
  it('counts per account and per address, and refuses past the cap', async () => {
    for (let i = 0; i < 3; i++) expect(await takeDaily('skin', { uid: 'u1' }, 3)).toBe(true);
    expect(await takeDaily('skin', { uid: 'u1' }, 3)).toBe(false);
    expect(await takeDaily('skin', { uid: 'u2' }, 3)).toBe(true);
    expect(await takeDaily('replayFrames', { ip: '1.2.3.4' }, 1)).toBe(true);
    expect(await takeDaily('replayFrames', { ip: '1.2.3.4' }, 1)).toBe(false);
    expect(await takeDaily('replayFrames', { ip: '5.6.7.8' }, 1)).toBe(true);
    // An address is never stored in the key.
    expect([...docs.keys()].some((k) => k.includes('1.2.3.4'))).toBe(false);
  });
});
