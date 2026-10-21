import { describe, expect, it } from 'vitest';
import { BUG_SPAWN_Z, choose, drinkCoffee, fixBug, newGame, tick, type Rng } from './engine';
import { EVENTS, type Effect, type Option } from './events';
import { strings } from './strings';

/* A seeded generator, so a run is the same run every time. */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(s: ReturnType<typeof newGame>, seconds: number, rng: Rng, each?: () => void) {
  for (let i = 0; i < seconds * 20 && !s.over; i++) {
    tick(s, 0.05, rng);
    each?.();
  }
}

describe('events', () => {
  it('every event has its timeout option, and every text in both languages', () => {
    for (const e of EVENTS) {
      expect(e.options[e.timeout], e.id).toBeDefined();
      const texts = [e.title, e.text, e.timeoutNote, ...e.options.flatMap((o) => [o.label, o.result, ...(o.risk ? [o.risk.result] : [])])];
      for (const t of texts) {
        expect(t.en.length, e.id).toBeGreaterThan(0);
        expect(t.pl.length, e.id).toBeGreaterThan(0);
      }
    }
  });

  it('UI strings have the same keys in both languages', () => {
    expect(Object.keys(strings.pl).sort()).toEqual(Object.keys(strings.en).sort());
    expect(strings.pl.grades).toHaveLength(strings.en.grades.length);
  });
});

describe('engine', () => {
  it('an unattended shift does not reach production', () => {
    const s = newGame(seeded(1));
    run(s, 600, seeded(2));
    expect(s.over === 'prod' || s.over === 'burnout').toBe(true);
    expect(s.stats.answered).toBe(0);
    expect(s.stats.bugsHit).toBeGreaterThan(0);
  });

  it('a diligent driver gets the release to production', () => {
    // Weighs each option by its expected effect; always taking the first one, which is what the
    // autopilot tends to pick, burns the driver out.
    const value = (e: Effect) =>
      (e.prod ?? 0) * 1.5 + (e.sanity ?? 0) - (e.debt ?? 0) - (e.km ?? 0) * 1.2 - (e.stop ?? 0) * 2;
    const best = (options: Option[]) => {
      const scored = options.map((o) =>
        o.risk ? value(o.effect) * (1 - o.risk.p) + value(o.risk.effect) * o.risk.p : value(o.effect),
      );
      return scored.indexOf(Math.max(...scored));
    };
    const rng = seeded(3);
    const s = newGame(rng);
    run(s, 900, rng, () => {
      for (const b of s.bugs) if (b.z < BUG_SPAWN_Z / 3) fixBug(s, b.id);
      if (s.active && s.active.timeLeft < 7) choose(s, best(s.active.event.options), rng);
      if (s.drowsy > 80 || s.sanity < 40) drinkCoffee(s);
    });
    expect(s.over).toBe('win');
    expect(s.stats.bugsHit).toBe(0);
  });

  it('the autopilot answers when the timer runs out', () => {
    const rng = seeded(4);
    const s = newGame(rng);
    run(s, 30, rng, () => {
      for (const b of s.bugs) fixBug(s, b.id);
    });
    expect(s.stats.autopiloted).toBeGreaterThan(0);
  });

  it('coffee has a cooldown and runs out', () => {
    const s = newGame(seeded(5));
    expect(drinkCoffee(s)).toBe(true);
    expect(drinkCoffee(s)).toBe(false);
    s.coffeeCooldown = 0;
    drinkCoffee(s);
    s.coffeeCooldown = 0;
    drinkCoffee(s);
    s.coffeeCooldown = 0;
    expect(s.coffees).toBe(0);
    expect(drinkCoffee(s)).toBe(false);
  });

  it('scope creep never puts the destination behind the truck', () => {
    const s = newGame(seeded(6));
    s.km = 50;
    s.active = { event: EVENTS.find((e) => e.id === 'microservices')!, timeLeft: 5 };
    // Serverless, with the risk forced: -5 km.
    choose(s, 2, () => 0);
    expect(s.totalKm).toBeGreaterThan(s.km);
  });
});
