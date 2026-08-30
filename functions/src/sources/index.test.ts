import { describe, expect, it } from 'vitest';
import { SOURCES } from './index';
import { SOURCE_CATALOGUE } from '../../../korczak-xyz/src/utils/events/sources';

/*
 * The adapters and the catalogue describe the same four things from two sides: how to read a page,
 * and which pages there are. They cannot be one file — the catalogue ships to the browser and an
 * adapter cannot — so the agreement is asserted here rather than assumed.
 *
 * The failure this catches is one-sided and silent: a fifth source added to `SOURCES` and forgotten
 * in the catalogue collects events the Sources tab claims nothing produces, and the reader has no
 * way to tell that from a source that is simply quiet.
 */
describe('SOURCES and the catalogue', () => {
  it('name the same sources', () => {
    expect(SOURCES.map((s) => s.id).sort()).toEqual(SOURCE_CATALOGUE.map((e) => e.id).sort());
  });

  it('agree on each source’s label, which is what a health row is read under', () => {
    for (const source of SOURCES) {
      const entry = SOURCE_CATALOGUE.find((e) => e.id === source.id);
      expect(entry?.label, `no catalogue entry for ${source.id}`).toBe(source.label);
    }
  });
});
