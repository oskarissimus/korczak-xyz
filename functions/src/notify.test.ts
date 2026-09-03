import { describe, expect, it } from 'vitest';
import { payloadFor } from './notify';
import type { PendingNotice } from '../../korczak-xyz/src/utils/events/notices';

const notice = (over: Partial<PendingNotice> = {}): PendingNotice => ({
  kind: 'announced',
  noticeId: 'x|announced',
  fingerprint: 'x',
  eventId: 'elektroniczne-zapisy_15822',
  interestIds: ['running-warszawa'],
  title: '48. Maraton Warszawski',
  startsAt: Date.parse('2026-09-27T08:00:00Z'),
  url: 'https://elektronicznezapisy.pl/event/15822/strona.html',
  ...over,
});

/*
 * A notification is the one place there is no card to open, so what the body says is the whole of
 * what the reader gets. For a race that has to include the distance: the title names it, and
 * naming is not deciding.
 */
describe('payloadFor', () => {
  it('puts the distance ahead of the date', () => {
    expect(payloadFor(notice({ distancesM: [42195] })).body).toBe('42.2 km · 27 Sept 2026');
  });

  it('lists every distance the race offers', () => {
    expect(payloadFor(notice({ distancesM: [5000, 21097] })).body).toBe(
      '5 km · 21.1 km · 27 Sept 2026',
    );
  });

  it('says the date alone when nothing is a race', () => {
    expect(payloadFor(notice()).body).toBe('27 Sept 2026');
  });

  it('keeps the on-sale wording, with the distance in front of it', () => {
    expect(payloadFor(notice({ kind: 'onsale', distancesM: [10000] })).body).toBe(
      '10 km · On sale now · 27 Sept 2026',
    );
  });

  /*
   * A presale names the sale moment instead of the start date, and the distance still belongs in
   * front of it: what is on sale is a 42 km run, and that is the half of the decision.
   */
  it('keeps the distance in front of a presale', () => {
    expect(
      payloadFor(
        notice({
          kind: 'presale',
          onSaleAt: Date.parse('2026-09-01T09:00:00Z'),
          distancesM: [42195],
        }),
      ).body,
    ).toBe('42.2 km · Tickets on sale from 1 Sept 2026, 11:00');
  });

  it('still says the distance for a race announced without a date', () => {
    expect(payloadFor(notice({ startsAt: null, distancesM: [21097] })).body).toBe(
      '21.1 km · Announced — no dates yet.',
    );
  });
});
