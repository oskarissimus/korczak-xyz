import { describe, expect, it } from 'vitest';

import {
  DEMO_DEFAULTS,
  callerIp,
  checkDemo,
  dayKey,
  ipKey,
  normalizeSettings,
  remaining,
} from './limits';

/*
 * These are the rules that stand between a stranger with a camera and somebody else's API quota,
 * so each case here is a way that has actually gone wrong somewhere: a cap read as `undefined`, a
 * forged header minting a fresh bucket, a day that rolls over in the wrong time zone.
 */
describe('normalizeSettings', () => {
  it('fills in every field from a document that has none', () => {
    expect(normalizeSettings(undefined)).toEqual(DEMO_DEFAULTS);
    expect(normalizeSettings({})).toEqual(DEMO_DEFAULTS);
  });

  // The one failure here that spends money: `undefined >= undefined` is false, so a missing cap
  // would read as no cap at all rather than as the default.
  it('never lets a cap through as anything but a number', () => {
    const settings = normalizeSettings({ perIpDaily: 'lots', perAppDaily: null });
    expect(settings.perIpDaily).toBe(DEMO_DEFAULTS.perIpDaily);
    expect(settings.perAppDaily).toBe(DEMO_DEFAULTS.perAppDaily);
  });

  it('clamps a cap somebody typed a few too many zeros into', () => {
    expect(normalizeSettings({ perIpDaily: 10_000 }).perIpDaily).toBe(200);
    expect(normalizeSettings({ perAppDaily: 1_000_000 }).perAppDaily).toBe(5000);
    expect(normalizeSettings({ perIpDaily: -5 }).perIpDaily).toBe(0);
  });

  it('reads the switches, and treats a missing one as on', () => {
    expect(normalizeSettings({ enabled: false }).enabled).toBe(false);
    expect(normalizeSettings({ apps: { roaster: false } }).apps).toEqual({
      backseat: true,
      roaster: false,
    });
  });

  it('trims the uid, because a pasted one brings a newline', () => {
    expect(normalizeSettings({ keyUid: '  abc123 ' }).keyUid).toBe('abc123');
    expect(normalizeSettings({ keyUid: 42 }).keyUid).toBe('');
  });
});

describe('checkDemo', () => {
  const settings = { ...DEMO_DEFAULTS, keyUid: 'owner', perIpDaily: 2, perAppDaily: 3 };

  it('allows a call inside both caps', () => {
    expect(checkDemo(settings, 'roaster', { ip: 0, app: 0 })).toEqual({ ok: true });
  });

  // A cap of 2 allows the 2nd call and refuses the 3rd: the counts are what has been spent.
  it('counts what is spent, not what is left', () => {
    expect(checkDemo(settings, 'roaster', { ip: 1, app: 1 })).toEqual({ ok: true });
    expect(checkDemo(settings, 'roaster', { ip: 2, app: 2 })).toMatchObject({ reason: 'ip-cap' });
  });

  it('says which cap, because the two need different sentences', () => {
    expect(checkDemo(settings, 'roaster', { ip: 0, app: 3 })).toMatchObject({
      reason: 'app-cap',
      status: 429,
    });
  });

  it('refuses before the counters when there is no key or no switch', () => {
    expect(checkDemo({ ...settings, enabled: false }, 'roaster', { ip: 0, app: 0 })).toMatchObject({
      reason: 'disabled',
    });
    expect(checkDemo({ ...settings, keyUid: '' }, 'roaster', { ip: 0, app: 0 })).toMatchObject({
      reason: 'no-key',
    });
    const off = { ...settings, apps: { backseat: true, roaster: false } };
    expect(checkDemo(off, 'roaster', { ip: 0, app: 0 })).toMatchObject({ reason: 'app-off' });
    expect(checkDemo(off, 'backseat', { ip: 0, app: 0 })).toEqual({ ok: true });
  });
});

describe('remaining', () => {
  it('never goes below zero, whatever the counters say', () => {
    const settings = { ...DEMO_DEFAULTS, perIpDaily: 5, perAppDaily: 10 };
    expect(remaining(settings, { ip: 2, app: 4 })).toEqual({ ip: 3, app: 6 });
    expect(remaining(settings, { ip: 99, app: 99 })).toEqual({ ip: 0, app: 0 });
  });
});

describe('callerIp', () => {
  /*
   * The usual advice behind a proxy you control is to take the first entry. Here that is exactly
   * wrong: the client writes the front of that list, so one header would mint a fresh bucket per
   * request and the per-IP cap would be decoration.
   */
  it('takes the last entry, which is the one Google saw', () => {
    expect(callerIp('203.0.113.9, 70.41.3.18, 150.172.238.178')).toBe('150.172.238.178');
    expect(callerIp('203.0.113.9')).toBe('203.0.113.9');
  });

  it('falls back to the socket, then to one shared bucket', () => {
    expect(callerIp(undefined, '198.51.100.7')).toBe('198.51.100.7');
    expect(callerIp('', '')).toBe('unknown');
    expect(callerIp(undefined)).toBe('unknown');
  });
});

describe('the day and the bucket', () => {
  it('rolls over at Warsaw midnight, not UTC', () => {
    // 22:30 UTC on 4 Oct is already the 5th in Warsaw (+02:00 in summer).
    expect(dayKey(Date.UTC(2026, 9, 4, 22, 30))).toBe('2026-10-05');
    expect(dayKey(Date.UTC(2026, 9, 4, 12, 0))).toBe('2026-10-04');
  });

  it('hashes an address so that no document holds one', () => {
    const key = ipKey('198.51.100.7', '2026-10-05');
    expect(key).toHaveLength(32);
    expect(key).not.toContain('198');
    expect(ipKey('198.51.100.7', '2026-10-05')).toBe(key);
  });

  // The day is in the salt as well as the path, so two days cannot be joined up afterwards.
  it('gives the same address a different bucket each day', () => {
    expect(ipKey('198.51.100.7', '2026-10-05')).not.toBe(ipKey('198.51.100.7', '2026-10-06'));
  });
});

/*
 * The roaster's demo speaks every three seconds over Live, so it is counted in sessions against
 * caps of its own. The failure this guards is one set of caps reaching the other: two-step caps
 * sized for a remark every twelve seconds would end a Live demo in under a minute, and the
 * reverse would let the two-step demo run for an hour.
 */
describe('the Live demo is counted apart', () => {
  const settings = normalizeSettings({ keyUid: 'owner', perIpDaily: 15, livePerIpDaily: 60 });

  it('checks a live call against the live caps', () => {
    expect(checkDemo(settings, 'roaster', { ip: 20, app: 20 }, 'live')).toEqual({ ok: true });
    expect(checkDemo(settings, 'roaster', { ip: 20, app: 20 }, 'remark')).toMatchObject({
      reason: 'ip-cap',
    });
    expect(checkDemo(settings, 'roaster', { ip: 60, app: 60 }, 'live')).toMatchObject({
      reason: 'ip-cap',
      status: 429,
    });
  });

  it('says what is left in the same units', () => {
    expect(remaining(settings, { ip: 10, app: 100 }, 'live')).toEqual({
      ip: 50,
      app: DEMO_DEFAULTS.livePerAppDaily - 100,
    });
  });

  /* A settings document saved before the Live demo existed has none of these fields, and must
     get the defaults rather than a cap of `undefined` — that document is the one in production. */
  it('fills the live fields into a document written before they existed', () => {
    const old = normalizeSettings({ keyUid: 'owner', model: 'gemini-2.5-flash-lite', perIpDaily: 15 });
    expect(old.liveModel).toBe(DEMO_DEFAULTS.liveModel);
    expect(old.livePerIpDaily).toBe(DEMO_DEFAULTS.livePerIpDaily);
    expect(old.livePerAppDaily).toBe(DEMO_DEFAULTS.livePerAppDaily);
  });
});
