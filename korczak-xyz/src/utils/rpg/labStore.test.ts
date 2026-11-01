import { beforeEach, describe, expect, it } from 'vitest';

import { addLabVariant, addOwnSource, labSpent, labVariants, ownSources, removeLabVariant, restoreLabVariant, restoreSource, sweepLab, trashedSources, trashedVariants, trashSource, type LabVariant } from './labStore';
import type { LabSource } from './labSources';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

const variant = (id: string, at: number): LabVariant => ({ id, method: 'trellis', pose: 'game', image: 'i', prompt: 'p', glb: `${id}.glb`, costUsd: 0.5, ms: 1, bytes: null, at });
const own = (id: string): LabSource => ({ id, worldId: 'lab', world: 'lab', lang: 'en', name: id, role: 'person', body: 'male', model: { glb: `${id}.glb`, image: 'i', prompt: 'p', costUsd: 1 } as never });

describe("the lab's trash", () => {
  it('hides a model and a person without deleting them, and brings them back', () => {
    addLabVariant('a', variant('v1', 10));
    removeLabVariant('a', 'v1');
    expect(labVariants('a')).toEqual([]);
    expect(trashedVariants().map((t) => t.variant.id)).toEqual(['v1']);
    restoreLabVariant('a', 'v1');
    expect(labVariants('a').map((v) => v.id)).toEqual(['v1']);

    trashSource('a');
    expect(Object.keys(trashedSources())).toEqual(['a']);
    restoreSource('a');
    expect(trashedSources()).toEqual({});
  });

  it('a clean slate puts away everything made before it, once, and its cost leaves the total', () => {
    addLabVariant('a', variant('old', 10));
    addLabVariant('a', variant('new', 30));
    addOwnSource(own('me'));
    expect(labSpent()).toBe(2);
    expect(sweepLab(20, 25)).toBe(2);
    expect(labVariants('a').map((v) => v.id)).toEqual(['new']);
    expect(Object.keys(trashedSources())).toEqual(['me']);
    expect(ownSources()).toHaveLength(1);
    expect(labSpent()).toBe(0.5);
    restoreSource('me');
    // Swept already: the same clean slate does not take it again.
    expect(sweepLab(20)).toBe(0);
    expect(trashedSources()).toEqual({});
  });
});
