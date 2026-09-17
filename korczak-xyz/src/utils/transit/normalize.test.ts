import { describe, expect, it } from 'vitest';
import {
  alertIdFor,
  contentHashOf,
  feedHashOf,
  hasProse,
  parseAlertId,
  proseOf,
  REPUBLISH_MARGIN_MS,
  republishedAt,
  revisionOf,
  transitIdFor,
} from './normalize';

/*
 * The real thing, off `transitItems/impediment_…p-176873` — the 12 Sep 2026 M1 suspension. Both
 * `<description>` and `<content:encoded>` in the RSS item held exactly this and nothing else.
 */
const STUB = 'ZAKOŃCZONO: Utrudnienia w kursowaniu pociągów metra na linii M1.';
/** The opening of the article behind that row, which is where the stations actually were. */
const ARTICLE =
  'Z przyczyn technicznych występują utrudnienia w kursowaniu pociągów metra na linii M1. ' +
  'Ruch pociągów metra został wstrzymany na odcinku Słodowiec – Dworzec Gdański. ' +
  'Metro kursuje w dwóch pętlach: Młociny <-> Słodowiec oraz Kabaty <-> Dworzec Gdański.';

describe('ids', () => {
  it('derives a document id from the feed and the permalink, and from nothing else', () => {
    const guid = 'https://www.wtp.waw.pl/utrudnienia/2026/09/03/utrudnienia-w-kursowaniu-linii-metra-m1-66/';
    expect(transitIdFor('impediment', guid)).toBe(transitIdFor('impediment', guid));
    expect(transitIdFor('impediment', guid)).not.toBe(transitIdFor('change', guid));
    expect(transitIdFor('impediment', guid)).not.toContain('/');
  });

  it('round-trips an alert id', () => {
    const id = alertIdFor('https://example.test/a/', 'route', 'deadbeefdeadbeef');
    expect(parseAlertId(id)).toEqual({
      guid: 'https-example-test-a',
      kind: 'route',
      revision: 'deadbeefdeadbeef',
    });
  });

  it('refuses an id that is not one', () => {
    expect(parseAlertId('nope')).toBeNull();
    expect(parseAlertId('a|route|')).toBeNull();
  });
});

describe('which publication of a communiqué this is', () => {
  const SEEN = Date.parse('2026-09-16T18:47:00Z');
  const row = { contentHash: 'deadbeefdeadbeef', firstSeenAt: SEEN, publishedAt: SEEN - 30_000 };

  /*
   * The ordinary case, and the one that has to stay untouched: a communiqué reaches us minutes
   * after it is published. Both callers compare their string against one already stored, so a
   * revision that changed shape here would invalidate the whole corpus on the deploy.
   */
  it('is the content hash alone for an item published before we met it', () => {
    expect(republishedAt(row)).toBeUndefined();
    expect(revisionOf(row)).toBe(row.contentHash);
  });

  it('tolerates a feed clock running slightly ahead of ours', () => {
    const skewed = { ...row, publishedAt: SEEN + REPUBLISH_MARGIN_MS - 1000 };
    expect(republishedAt(skewed)).toBeUndefined();
    expect(revisionOf(skewed)).toBe(row.contentHash);
  });

  /*
   * 17 Sep 2026. A fresh M1 closure was published under the previous evening's post id — same
   * guid, same headline, same one-sentence body, and the article text of the night before, so
   * every digest this app takes came back identical and the alert was latched away by the one sent
   * 24 hours earlier. The publication date is the only field that moved.
   */
  it('carries the publication date once WTP has published the post again', () => {
    const again = { ...row, publishedAt: SEEN + 86_400_000 };
    expect(republishedAt(again)).toBe(again.publishedAt);
    expect(revisionOf(again)).not.toBe(revisionOf(row));
    expect(alertIdFor('g', 'route', revisionOf(again))).not.toBe(
      alertIdFor('g', 'route', revisionOf(row)),
    );
  });

  /** Two re-publications of one post are two incidents, and the second is not the first. */
  it('tells one re-publication from the next', () => {
    const tuesday = { ...row, publishedAt: SEEN + 86_400_000 };
    const wednesday = { ...row, publishedAt: SEEN + 2 * 86_400_000 };
    expect(revisionOf(wednesday)).not.toBe(revisionOf(tuesday));
  });

  /** Decided from stored fields that never move again, so a re-run reaches the same id. */
  it('is stable across runs', () => {
    const again = { ...row, publishedAt: SEEN + 86_400_000 };
    expect(revisionOf(again)).toBe(revisionOf({ ...again }));
  });

  /** `parseAlertId` still cuts cleanly: the date is inside the third part, not a fourth. */
  it('leaves an alert id in three parts', () => {
    const again = { ...row, publishedAt: SEEN + 86_400_000 };
    expect(parseAlertId(alertIdFor('https://example.test/a/', 'route', revisionOf(again)))).toEqual({
      guid: 'https-example-test-a',
      kind: 'route',
      revision: revisionOf(again),
    });
  });
});

describe('is there anything here to read', () => {
  /*
   * The case this exists for. Read from that sentence the extractor answers "no station is closed",
   * which is true of the sentence and false of the morning: four stations were shut and the line
   * ran as two loops. An unreadable item must stay unread, so `impactOf` escalates it.
   */
  it('does not call WTP\'s headline a communiqué', () => {
    expect(hasProse({ body: STUB })).toBe(false);
    expect(hasProse({ body: 'ZAKOŃCZONO . Utrudnienia w kursowaniu pociągów linii metra M1.' })).toBe(false);
    expect(hasProse({ body: 'Utrudnienia w kursowaniu linii 112,114,132,134,156,186,326,414,518,705,735.' })).toBe(false);
    expect(hasProse({})).toBe(false);
  });

  it('calls the article behind it one', () => {
    expect(hasProse({ body: STUB, article: ARTICLE })).toBe(true);
  });

  it('prefers the article, so one accessor decides what "the text" is everywhere', () => {
    expect(proseOf({ body: STUB, article: ARTICLE })).toBe(ARTICLE);
    expect(proseOf({ body: STUB })).toBe(STUB);
    expect(proseOf({})).toBe('');
  });
});

describe('contentHashOf', () => {
  it('changes when the prose changes', () => {
    expect(contentHashOf({ title: 'a', body: 'x' })).not.toBe(contentHashOf({ title: 'a', body: 'y' }));
    expect(contentHashOf({ title: 'a' })).not.toBe(contentHashOf({ title: 'b' }));
  });

  it('does not change for whitespace, case or diacritics-only churn in the CMS', () => {
    expect(contentHashOf({ title: 'Metro M1', body: 'Stacja  Centrum ' })).toBe(
      contentHashOf({ title: 'metro m1', body: 'Stacja Centrum' }),
    );
  });

  /*
   * The article is in the hash and the feed's own text is not, which is what makes a re-read
   * possible at all: WTP edits the page as a closure grows while the RSS row stays the one sentence
   * it has always been, so a digest over the feed alone would freeze the first reading in place.
   */
  it('moves when the article arrives, and again when the article changes', () => {
    const feedOnly = contentHashOf({ title: 'Utrudnienia w komunikacji: M1', body: STUB });
    const withArticle = contentHashOf({ title: 'Utrudnienia w komunikacji: M1', body: STUB, article: ARTICLE });
    const grown = contentHashOf({
      title: 'Utrudnienia w komunikacji: M1',
      body: STUB,
      article: `${ARTICLE} Zamknięta jest także stacja Ratusz Arsenał.`,
    });
    expect(withArticle).not.toBe(feedOnly);
    expect(grown).not.toBe(withArticle);
  });

  /*
   * Every row written before `article` existed must hash to what it hashed to then, or the first
   * run after the deploy re-reads the whole corpus and re-alerts on all of it.
   */
  it('is unchanged for an item that has no article', () => {
    expect(contentHashOf({ title: 'a', body: 'x' })).toBe(feedHashOf({ title: 'a', body: 'x' }));
  });

  it('is sixteen hex characters, so an alert id stays readable in a console', () => {
    expect(contentHashOf({ title: 'a', body: 'b' })).toMatch(/^[0-9a-f]{16}$/);
  });

  /*
   * A change detector rather than a digest, so the module stays portable — but it still has to be
   * one. Two passes over a few thousand realistic strings must not collide.
   */
  it('does not collide across the shapes this feed actually produces', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i += 1) {
      seen.add(contentHashOf({ title: `Utrudnienia w komunikacji: ${i}`, body: `Stacja nr ${i} zamknięta.` }));
    }
    expect(seen.size).toBe(4000);
  });
});
