import { describe, expect, it } from 'vitest';

import { cleanEvent, cleanEvents, cleanSummary, newReplayId, redact, REPLAY_ID, REPLAY_LIMITS, type ReplayEvent } from './replay';
import { buildTimeline, clock, delay, heroPose, notYetMet, stateAt } from './replayTimeline';

const session: ReplayEvent[] = [
  { t: 0, k: 'open', lang: 'pl' },
  { t: 10, k: 'screen', s: 'main' },
  { t: 1000, k: 'screen', s: 'game' },
  { t: 1000, k: 'quest', id: 'q-1', mode: 'demo' },
  { t: 1000, k: 'wait', r: 'opening' },
  { t: 1100, k: 'req', id: 1, kind: 'model', model: 'gemini', n: 0 },
  { t: 1200, k: 'req', id: 2, kind: 'fal', model: 'flux', label: 'landmark' },
  { t: 9000, k: 'res', id: 1, ms: 7900, ok: true, usd: 0.001 },
  { t: 9000, k: 'waited', r: 'opening', ms: 8000 },
  { t: 9001, k: 'beat', n: 0, title: 'Mgła', goal: 'Porozmawiaj z sołtysem', npc: 'Radomir', place: 'Wieś' },
  { t: 20000, k: 'res', id: 2, ms: 18800, ok: true },
  { t: 21000, k: 'show', id: 's1', what: 'landmark', name: 'landmark' },
  { t: 23000, k: 'shown', id: 's1', ms: 2000, ok: true },
  { t: 24000, k: 'show', id: 's2', what: 'person', name: 'Radomir' },
  { t: 30000, k: 'line', kind: 'npc', who: 'Radomir', text: 'Witaj.' },
  { t: 31000, k: 'choice', label: 'Pomogę', kind: 'plot' },
  { t: 31000, k: 'wait', r: 'unfolding' },
  { t: 40000, k: 'idle', ms: 35000 },
  { t: 41000, k: 'hide' },
];

describe('the replay timeline', () => {
  const tl = buildTimeline(session);

  it('lays the screens, the beats and the waits end to end', () => {
    expect(tl.ms).toBe(41000);
    expect(tl.screens.map((s) => [s.label, s.from, s.to])).toEqual([
      ['main', 10, 1000],
      ['game', 1000, 41000],
    ]);
    expect(tl.beats).toEqual([{ from: 9001, to: 41000, label: '1. Mgła' }]);
    expect(tl.waits).toEqual([
      { from: 1000, to: 9000, label: 'opening' },
      { from: 31000, to: 41000, label: 'unfolding', open: true },
    ]);
    expect(tl.idle).toEqual([{ from: 5000, to: 40000, label: 'idle' }]);
    expect(tl.hidden).toEqual([{ from: 41000, to: 41000, label: 'hidden', open: true }]);
  });

  it('measures an asset from its request to standing, and says when nothing was asked for it', () => {
    const [landmark, person] = tl.assets;
    expect(landmark).toMatchObject({ what: 'landmark', askedAt: 1200, madeAt: 20000, showAt: 21000, shownAt: 23000, totalMs: 21800, beat: 0, kept: false, ok: true });
    expect(person).toMatchObject({ what: 'person', name: 'Radomir', askedAt: null, shownAt: null, totalMs: null, kept: true });
  });

  it('reads the state at a moment', () => {
    const early = stateAt(session, 5000);
    expect(early.screen).toBe('game');
    expect(early.waiting).toEqual(['opening']);
    expect(early.pending).toEqual(['model · gemini', 'fal · landmark']);
    expect(early.beat).toBeNull();
    const later = stateAt(session, 32000);
    expect(later.beat?.title).toBe('Mgła');
    expect(later.line).toEqual({ who: 'Radomir', text: 'Witaj.' });
    expect(later.act?.label).toBe('Pomogę');
    expect(later.waiting).toEqual(['unfolding']);
    expect(later.loading).toEqual(['person · Radomir']);
  });

  it('puts the dialogue, a banner and a stall back on the screen', () => {
    const shown: ReplayEvent[] = [
      { t: 0, k: 'screen', s: 'game' },
      { t: 100, k: 'notice', title: 'Nowe zadanie', text: 'Mgła' },
      { t: 200, k: 'menu', who: 'Radomir', text: 'Witaj.', opts: 'Kto? | Żegnaj' },
      { t: 9000, k: 'menu' },
      { t: 9500, k: 'stall', why: 'Google 503' },
      { t: 9500, k: 'wait', r: 'stalled' },
      { t: 12000, k: 'waited', r: 'stalled', ms: 2500 },
    ];
    expect(stateAt(shown, 1000)).toMatchObject({ notice: { title: 'Nowe zadanie' }, dialog: { who: 'Radomir', opts: ['Kto?', 'Żegnaj'] } });
    expect(stateAt(shown, 9200)).toMatchObject({ notice: null, dialog: null });
    expect(stateAt(shown, 10000).stall).toBe('Google 503');
    expect(stateAt(shown, 12500).stall).toBeNull();
  });

  it('prints times', () => {
    expect(clock(65_000)).toBe('1:05');
    expect(clock(3_723_000)).toBe('1:02:03');
    expect(delay(850)).toBe('850 ms');
    expect(delay(4200)).toBe('4.2 s');
    expect(delay(null)).toBe('—');
  });
});

describe('what the server keeps of a chunk', () => {
  it('takes keys out of every string', () => {
    expect(redact('bad key AIzaSyA1234567890abcdefghijKLMNOP here')).toBe('bad key […] here');
    expect(redact('Authorization: Bearer abcdefghijklmnop123')).toBe('Authorization: […]');
    expect(redact('https://x.test/a?key=secret123&b=1')).toBe('https://x.test/a?key=[…]&b=1');
    expect(redact('sk-proj-abcdefghijklmnopqrst')).toBe('[…]');
    expect(redact('x'.repeat(400))).toHaveLength(REPLAY_LIMITS.text);
  });

  it('keeps known kinds with flat fields only', () => {
    expect(cleanEvent({ t: 5.4, k: 'choice', label: 'Tak', deep: { a: 1 }, n: 2, ok: true, 'bad-name': 1 })).toEqual({ t: 5, k: 'choice', label: 'Tak', n: 2, ok: true });
    expect(cleanEvent({ t: 1, k: 'nonsense' })).toBeNull();
    expect(cleanEvent({ t: -1, k: 'open' })).toBeNull();
    expect(cleanEvents([{ t: 1, k: 'open' }, 'x', { t: 2, k: 'hide' }])).toHaveLength(2);
    expect(cleanEvents(Array.from({ length: 1000 }, (_, i) => ({ t: i, k: 'pos', x: 1, z: 2 })))).toHaveLength(REPLAY_LIMITS.chunkEvents);
  });

  it('clamps a summary', () => {
    expect(cleanSummary({ waitMs: -5, beats: 3.6, ended: 'yes', last: 'game' })).toMatchObject({ waitMs: 0, beats: 4, ended: false, last: 'game' });
  });

  it('mints ids the server accepts', () => {
    for (let i = 0; i < 50; i++) expect(newReplayId()).toMatch(REPLAY_ID);
    expect(newReplayId(Date.UTC(2026, 10, 24), () => 0)).toMatch(REPLAY_ID);
  });
});

describe('the rebuilt scene', () => {
  const ev = (t: number, k: string, f: Record<string, unknown> = {}): ReplayEvent => ({ t, k, ...f }) as ReplayEvent;
  it('walks the hero between two positions and faces the way they went', () => {
    const events = [ev(1000, 'pos', { x: 0, z: 0 }), ev(3000, 'pos', { x: 10, z: 0 })];
    expect(heroPose(events, 2000)).toEqual({ x: 5, z: 0, dx: 10, dz: 0 });
    expect(heroPose(events, 500)).toEqual({ x: 0, z: 0, dx: 0, dz: 0 });
    expect(heroPose(events, 9000)).toEqual({ x: 10, z: 0, dx: 10, dz: 0 });
    expect(heroPose([], 9000)).toBeNull();
  });
  it('does not glide across a long stand', () => {
    const events = [ev(1000, 'pos', { x: 0, z: 0 }), ev(60_000, 'pos', { x: 10, z: 0 })];
    expect(heroPose(events, 30_000)).toMatchObject({ x: 0, z: 0 });
  });
  it('leaves out what a later step first brings in', () => {
    const events = [
      ev(1000, 'beat', { n: 0, npc: 'Bratek', place: '' }),
      ev(5000, 'beat', { n: 1, npc: 'Mira', place: 'Rdzeń' }),
      ev(9000, 'beat', { n: 2, npc: 'Bratek', place: 'Rdzeń' }),
    ];
    expect(notYetMet(events, 2000)).toEqual({ places: new Set(['Rdzeń']), people: new Set(['Mira']) });
    expect(notYetMet(events, 6000)).toEqual({ places: new Set(), people: new Set() });
  });
});
