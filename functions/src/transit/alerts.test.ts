import { describe, expect, it } from 'vitest';
import { fetchAlerts, parseAlerts, postIdOf, postIdOfAlert } from './alerts';

/** One row, exactly as the live feed served it on 14 Sep 2026. */
const REAL_ROW = {
  id: 'A/CHANGE/176745',
  title: 'Zakończenie remontu torowiska w Al. Niepodległości',
  body:
    'W związku z zakończeniem remontu torowiska w Al. Niepodległości od poniedziałku 14 września:\n\n' +
    'TRAMWAJE\n\n14\n\nwznowienie kursowania linii na trasie podstawowej MIASTECZKO WILANÓW — BANACHA',
  link: 'https://www.wtp.waw.pl/zmiany/2026/09/11/zakonczenie-remontu-torowiska-w-al-nbspniepodleglosci/',
  routes: ['14', '17', '19', '33', '174'],
};

const feed = (alerts: unknown[]) => JSON.stringify({ time: '2026-09-14T21:43:36+02:00', alerts });

function ok(body: string): Response {
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}

describe('the join onto our corpus', () => {
  /*
   * The whole reason this source is usable: the alert id ends in WTP's own post id, which is the
   * number already sitting in our guid. No fuzzy title matching, no date windows.
   */
  it('is the post id, on both sides', () => {
    expect(postIdOfAlert('A/CHANGE/176745')).toBe('176745');
    expect(postIdOf({ guid: 'https://www.wtp.waw.pl/?post_type=change&p=176745' })).toBe('176745');
  });

  /*
   * Matched on the trailing number rather than the whole shape: the prefix is the generator's
   * vocabulary, not WTP's, and a build that renamed it would otherwise index nothing at all —
   * silently, since an empty index is indistinguishable from a quiet evening.
   */
  it('survives a prefix this build has never seen', () => {
    expect(postIdOfAlert('A/IMPEDIMENT/176873')).toBe('176873');
    expect(postIdOfAlert('A/SOMETHING-NEW/176873')).toBe('176873');
    expect(postIdOfAlert('nothing-numeric')).toBeUndefined();
    expect(postIdOfAlert(7)).toBeUndefined();
    expect(postIdOf({ guid: 'https://www.wtp.waw.pl/zmiany/2026/09/11/a-slug/' })).toBeUndefined();
  });
});

describe('parsing the feed', () => {
  it('indexes a real row by its post id, keeping the body', () => {
    const index = parseAlerts(feed([REAL_ROW]));
    expect(index.count).toBe(1);
    expect(index.byPostId.get('176745')?.body).toContain('Al. Niepodległości');
  });

  /*
   * Total by construction, exactly as `parseReadings` is. A mirror that changes shape has to
   * degrade this app to what it was without it — unread items, escalated — never break a run.
   */
  it('yields an empty index for anything that is not the feed, rather than throwing', () => {
    expect(parseAlerts('not json').byPostId.size).toBe(0);
    expect(parseAlerts('not json').error).toContain('not JSON');
    expect(parseAlerts('{"alerts":"nope"}').error).toBe('no alerts array');
    expect(parseAlerts(feed([null, 7, 'x'])).byPostId.size).toBe(0);
  });

  it('drops a row with no body, since a row with nothing to read is not an answer', () => {
    const index = parseAlerts(feed([{ ...REAL_ROW, body: '   ' }, { ...REAL_ROW, id: 'A/CHANGE/1', body: 'x' }]));
    expect([...index.byPostId.keys()]).toEqual(['1']);
    // Both rows are still counted: the feed had two, and one of them was unusable.
    expect(index.count).toBe(2);
  });

  /*
   * An empty feed is a real answer — nine live alerts on a busy afternoon, none at four in the
   * morning — and it must not read as a failure. `count` is what tells that apart from a mirror
   * that has stopped, which is why it is on the outcome.
   */
  it('treats a feed with no alerts as an answer, not an error', () => {
    const index = parseAlerts(feed([]));
    expect(index.error).toBeUndefined();
    expect(index.count).toBe(0);
  });
});

describe('fetching it', () => {
  it('indexes what the mirror served', async () => {
    const index = await fetchAlerts(async () => ok(feed([REAL_ROW])));
    expect(index.byPostId.get('176745')).toBeDefined();
  });

  it('names every way the mirror can fail, and never throws', async () => {
    const down = { ok: false, status: 502, text: async () => '' } as unknown as Response;
    expect((await fetchAlerts(async () => down)).error).toBe('HTTP 502');
    expect(
      (
        await fetchAlerts(async () => {
          throw new Error('getaddrinfo ENOTFOUND');
        })
      ).error,
    ).toBe('getaddrinfo ENOTFOUND');
  });

  /* A mirror that starts serving a gigabyte is a bug on their side, not memory to spend on ours. */
  it('refuses a body too large to be this feed', async () => {
    const index = await fetchAlerts(async () => ok('x'.repeat(3_000_000)));
    expect(index.error).toContain('refusing to parse');
  });
});
