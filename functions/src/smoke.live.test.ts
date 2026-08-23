import { describe, expect, it } from 'vitest';
import { SOURCES } from './sources';
import { toRecord } from './upsert';
import { isWorthKeeping } from './collect';
import { seedInterests } from '../../korczak-xyz/src/utils/events/interests';
import { matchingInterests } from '../../korczak-xyz/src/utils/events/match';
import { buildFeed } from '../../korczak-xyz/src/utils/events/feed';
import type { EventRecord } from '../../korczak-xyz/src/utils/events/types';

/*
 * Hits the real network. Opt-in via LIVE=1, so CI and an offline laptop are unaffected — this is a
 * smoke test for "do the adapters still understand these sites", which is a question only the sites
 * can answer.
 */
const live = process.env.LIVE === '1';
const maybe = live ? describe : describe.skip;

maybe('live sources', () => {
  const now = Date.now();
  const ctx = { now, fetch: globalThis.fetch, secret: () => undefined };
  const collected: EventRecord[] = [];

  it.each(SOURCES.map((s) => [s.id, s] as const))(
    '%s returns usable events',
    async (id, source) => {
      let raw;
      try {
        raw = await source.fetchEvents(ctx);
      } catch (e) {
        if (id === 'ticketmaster') return; // no API key here
        throw e;
      }
      const records = raw
        .map((r) => toRecord(r, source.id, source.label, now))
        .filter((r) => isWorthKeeping(r, now));
      collected.push(...records);
      console.log(`  ${id}: ${raw.length} raw -> ${records.length} kept`);
      for (const r of records.slice(0, 3)) {
        console.log(`    ${r.day ?? r.dateText ?? '—'}  ${r.title}  [${r.tags.join(',')}]`);
      }
      if (id !== 'ticketmaster') expect(raw.length).toBeGreaterThan(0);
    },
    60000,
  );

  it('matches the seeded interests against what came back', () => {
    const seeds = seedInterests({ writerId: 'smoke', now: 0 });
    const hits = new Map<string, number>();
    for (const record of collected) {
      for (const interest of matchingInterests(record, seeds, { forPush: false })) {
        hits.set(interest.label, (hits.get(interest.label) ?? 0) + 1);
      }
    }
    console.log('\n  matches by interest:');
    for (const seed of seeds) console.log(`    ${seed.label}: ${hits.get(seed.label) ?? 0}`);

    const sections = buildFeed(collected, seeds, now);
    console.log(`\n  feed: ${sections.map((s) => `${s.group}=${s.items.length}`).join(' ')}`);
    for (const section of sections) {
      for (const item of section.items.slice(0, 4)) {
        console.log(
          `    [${section.group}] ${item.event.title} — ${item.matched.map((i) => i.label).join(', ')}`,
        );
      }
    }
    expect(collected.length).toBeGreaterThan(0);
  });
});
