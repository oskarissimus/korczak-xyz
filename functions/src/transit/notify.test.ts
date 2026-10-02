import { describe, expect, it } from 'vitest';
import { payloadFor } from './notify';
import { mergeItem } from './upsert';
import { newSegment, SEED_SEGMENTS } from '../../../korczak-xyz/src/utils/transit/segments';
import { impactOf } from '../../../korczak-xyz/src/utils/transit/impact';
import { alertIdFor } from '../../../korczak-xyz/src/utils/transit/normalize';
import type { PendingAlert } from '../../../korczak-xyz/src/utils/transit/notices';
import type { TransitItem, WatchedSegment } from '../../../korczak-xyz/src/utils/transit/types';

const NOW = Date.parse('2026-08-27T18:10:00Z');
const SEGMENTS: WatchedSegment[] = SEED_SEGMENTS.map((seed) => newSegment(seed, seed.id, 'w', NOW)!);

/*
 * A whole communiqué. `hasProse` treats an item carrying only WTP's headline as unread whatever it
 * stores, so a fixture with no body would make every banner here the uncertain one.
 */
const PROSE =
  'Z przyczyn technicznych występują utrudnienia w kursowaniu pociągów metra na linii M1. ' +
  'Ruch pociągów metra został wstrzymany na odcinku Słodowiec – Dworzec Gdański. ' +
  'Trwa uruchamianie zastępczej komunikacji autobusowej ZA METRO.';

function item(patch: Partial<TransitItem> = {}): TransitItem {
  return {
    id: 'impediment_a',
    feed: 'impediment',
    guid: 'https://www.wtp.waw.pl/utrudnienia/a/',
    title: 'Utrudnienia w komunikacji: M1',
    url: 'https://www.wtp.waw.pl/utrudnienia/a/',
    body: PROSE,
    publishedAt: NOW,
    titleLines: ['M1'],
    contentHash: 'aaaaaaaaaaaaaaaa',
    firstSeenAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

/** The banner as the run at `NOW` would send it. */
function at(alert: PendingAlert, now = NOW) {
  return payloadFor(alert, now);
}

function pending(patch: Partial<TransitItem>): PendingAlert {
  const record = item(patch);
  const verdict = impactOf(record, SEGMENTS)!;
  const kind = verdict.impact;
  return { alertId: alertIdFor(record.guid, kind, record.contentHash), kind, item: record, verdict };
}

describe('the banner', () => {
  it('puts the priority in the title, because that is what a glance takes in', () => {
    const route = at(pending({ closedStops: ['Centrum', 'Politechnika'] }));
    expect(route.title).toContain('Twoja trasa');
    expect(route.title).toContain('M1');

    const line = at(pending({ closedStops: ['Kabaty'] }));
    expect(line.title).not.toContain('Twoja trasa');
  });

  /*
   * The stop names lead. Every metro headline WTP writes is "Utrudnienia w komunikacji: M1" — what
   * distinguishes tonight's from last week's is which stations are shut, and a lock screen has no
   * card to open.
   */
  it('says which stations on the route are shut, and nothing else', () => {
    const payload = at(
      pending({
        closedStops: ['Centrum', 'Politechnika', 'Kabaty'],
        summary: 'Pociągi nie kursują',
        reason: 'awaria taboru',
        effectiveFrom: NOW,
      }),
    );
    expect(payload.body).toBe('20:10 · Zamknięte: Centrum, Politechnika');
  });

  it('says the route is open when only another stretch of the line is shut', () => {
    expect(at(pending({ closedStops: ['Kabaty'], reason: 'awaria taboru' })).body).toBe(
      '20:10 · Stacje na Twojej trasie są otwarte.',
    );
  });

  it('says when it does not know, rather than shouting about nothing', () => {
    const payload = at(pending({}));
    expect(payload.body).toContain('Nie udało się odczytać');
  });

  it('says so when the whole line is down', () => {
    expect(at(pending({ wholeLine: true, closedStops: [] })).body).toContain('Cała linia');
  });

  it('tags on the alert id, so an edited communiqué replaces its own banner group', () => {
    const payload = at(pending({ closedStops: ['Centrum'] }));
    expect(payload.tag).toContain('aaaaaaaaaaaaaaaa');
    expect(payload.url).toBe('/apps/transit');
  });
});

/*
 * The ending of a closure, 2 Oct 2026 as it was stored: WTP rewrote the row's description to say it
 * is over, and the mirror's article was the one sentence left un-struck — too short for `hasProse`,
 * which used to make this the "could not read it" banner.
 */
describe('an ended communiqué', () => {
  const ended = {
    body: 'Zakończone utrudnienia w kursowaniu pociągów metra linia M1',
    article: 'Trwa przywracanie podstawowej organizacji ruchu.\n\nPrzepraszamy za utrudnienia',
    closedStops: ['Centrum', 'Politechnika'],
  };

  it('says it is over, not that it could not be read', () => {
    const payload = at(pending(ended), NOW + 3 * 3600_000);
    expect(payload.title).toBe('✅ M1 · koniec utrudnień');
    expect(payload.body).toBe('23:10 · Koniec utrudnień, trwa przywracanie ruchu.');
  });

  it('is filed where the closure was, from the reading taken while it was live', () => {
    expect(pending(ended).kind).toBe('route');
    expect(pending({ ...ended, closedStops: ['Kabaty'] }).kind).toBe('line');
    // Nothing placed to go on: the route, as everything unknown is.
    expect(pending({ ...ended, closedStops: undefined }).kind).toBe('route');
  });

  it('reads the older ZAKOŃCZONO: prefix too', () => {
    const payload = at(pending({ body: 'ZAKOŃCZONO: Utrudnienia w kursowaniu pociągów metra na linii M1.' }));
    expect(payload.body).toBe('20:10 · Koniec utrudnień.');
  });
});

describe('the time on the banner', () => {
  it('is the publication time in Warsaw for a closure, summer and winter alike', () => {
    expect(at(pending({ publishedAt: Date.parse('2026-10-02T03:23:43Z') })).body).toMatch(/^05:23 · /);
    expect(at(pending({ publishedAt: Date.parse('2026-12-02T03:23:43Z') })).body).toMatch(/^04:23 · /);
  });

  it('pads the hour', () => {
    expect(at(pending({ publishedAt: Date.parse('2026-12-02T07:05:00Z') })).body).toMatch(/^08:05 · /);
    expect(at(pending({ publishedAt: Date.parse('2026-12-01T23:30:00Z') })).body).toMatch(/^00:30 · /);
  });
});

describe('mergeItem', () => {
  const stored = {
    ...item(),
    firstSeenAt: NOW - 86400000,
    closedStops: ['Centrum'],
    reason: 'awaria taboru',
    extractHash: '1:aaaaaaaaaaaaaaaa',
    extractedAt: NOW - 86400000,
  };

  it('keeps firstSeenAt, which is what armedAt is measured against', () => {
    expect(mergeItem(item(), stored, NOW).record.firstSeenAt).toBe(NOW - 86400000);
    expect(mergeItem(item(), null, NOW).record.firstSeenAt).toBe(NOW);
  });

  /*
   * `batch.set` replaces the whole document, so a field not named in the merge is deleted — and a
   * deleted reading is one paid for again on the very next fetch, every ten minutes, for ever.
   */
  it('carries the reading forward across a fetch that changed nothing', () => {
    const merged = mergeItem(item(), stored, NOW).record;
    expect(merged.closedStops).toEqual(['Centrum']);
    expect(merged.reason).toBe('awaria taboru');
    expect(merged.extractHash).toBe('1:aaaaaaaaaaaaaaaa');
  });

  /*
   * And keeps it across an edit, deliberately. Leaving the old extractHash beside a new
   * contentHash is exactly what makes `needsExtracting` true and what lets the Raw tab say "this
   * reading is out of date" — clearing it would lose the difference between never-read and stale.
   */
  it('leaves a stale reading in place beside the new text, rather than clearing it', () => {
    const edited = mergeItem(item({ contentHash: 'bbbbbbbbbbbbbbbb' }), stored, NOW).record;
    expect(edited.contentHash).toBe('bbbbbbbbbbbbbbbb');
    expect(edited.extractHash).toBe('1:aaaaaaaaaaaaaaaa');
  });
});
