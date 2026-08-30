import { describe, expect, it } from 'vitest';
import { SOURCES } from './sources';
import { toRecord } from './upsert';
import { isWorthKeeping } from './collect';
import { seedInterests } from '../../korczak-xyz/src/utils/events/interests';
import { matchingInterests } from '../../korczak-xyz/src/utils/events/match';
import { buildFeed } from '../../korczak-xyz/src/utils/events/feed';
import { classifyEvents } from './classify';
import type { EventRecord, Reach } from '../../korczak-xyz/src/utils/events/types';

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

/*
 * The classifier against real listings, which is the only way to check the premise this feature
 * rests on: that a model can tell PyCon NL from EuroPython when nothing in either listing says so.
 *
 * There is no key to set. Vertex AI on Application Default Credentials, so locally:
 *
 *   gcloud auth application-default login
 *   GOOGLE_CLOUD_PROJECT=korczak-xyz-501720 LIVE=1 npx vitest run smoke.live
 *
 * It prints every verdict with the model's reasoning, so a disagreement is something to read
 * rather than something to infer from a red assertion. It also settles two things no unit test
 * can: that `LOCATION` in classify.ts actually serves this model, and that Vertex accepts the
 * response schema.
 */
maybe('live classifier', () => {
  const now = Date.now();

  const cases: Array<{ title: string; city?: string; country?: string; expect: Reach }> = [
    { title: 'PyCon NL 2026', city: 'Utrecht', expect: 'national' },
    { title: 'PyCon Cameroon 2026', city: 'Yaoundé', expect: 'national' },
    { title: 'PyCon Greece 2026', city: 'Athens', expect: 'national' },
    { title: 'EuroPython 2026', city: 'Prague', expect: 'international' },
    { title: 'PyCon US 2026', city: 'Pittsburgh', expect: 'international' },
    { title: 'Wesele Figara', city: 'Warszawa', country: 'PL', expect: 'local' },
  ];

  it(
    'tells a national conference from one people fly to',
    async () => {
      const project = process.env.GOOGLE_CLOUD_PROJECT;
      if (!project) {
        console.log('  no GOOGLE_CLOUD_PROJECT set — skipping');
        return;
      }

      const records = cases.map((c, i) =>
        toRecord(
          {
            sourceKey: `smoke-${i}`,
            title: c.title,
            url: 'https://example.test/e',
            startsAt: now + 30 * 86400000,
            city: c.city,
            country: c.country,
            tags: ['tech'],
          },
          'python-org',
          'python.org events',
          now,
        ),
      );

      const written = new Map<string, Partial<EventRecord>>();
      const { outcome } = await classifyEvents(records, {
        now,
        project,
        write: async (id, update) => {
          written.set(id, update);
        },
      });

      // A location that does not serve the model, or ADC that was never set up, arrives here as
      // every event unlabelled — so say which it was rather than failing on a bare count.
      if (outcome.error) console.log(`  classifier error: ${outcome.error}`);

      console.log(`\n  classified ${outcome.classified}, unlabelled ${outcome.missing}`);
      let agreed = 0;
      for (let i = 0; i < records.length; i++) {
        const update = written.get(records[i].id);
        const got = update?.reach ?? '—';
        const mark = got === cases[i].expect ? '✓' : '✗';
        if (got === cases[i].expect) agreed += 1;
        console.log(
          `    ${mark} ${cases[i].title.padEnd(22)} ${String(update?.country ?? '—').padEnd(7)}` +
            ` ${String(got).padEnd(14)} want ${cases[i].expect}` +
            (update?.reachReason ? `  — ${update.reachReason}` : ''),
        );
      }

      // Every one of them has to come back labelled: a parse that silently drops rows is the
      // failure this is really watching for.
      expect(outcome.classified).toBe(records.length);

      /*
       * Not an exact-match assertion on all six. A judgement is allowed to differ at the margins —
       * that is what the verdicts printed above are for — but a model that agrees with four of six
       * is not doing the job this feature is built on, and the run should say so.
       */
      expect(agreed).toBeGreaterThanOrEqual(5);
    },
    120000,
  );
});
