import { describe, expect, it } from 'vitest';
import { MedianWindow, OneEuroFilter } from './smoothing';

describe('MedianWindow', () => {
  it('withholds a result until it has a full window to judge against', () => {
    const window = new MedianWindow(5);
    expect(window.push(1)).toBeNull();
    expect(window.push(2)).toBeNull();
    expect(window.push(3)).toBeNull();
    expect(window.push(4)).toBeNull();
    expect(window.push(5)).toBe(3);
    expect(window.filled).toBe(true);
  });

  /*
   * The job this filter exists for. A frame that latched onto the wrong period is not a small
   * error to be averaged down — it is an octave out. A mean would smear it across the next five
   * frames; a median discards it as though it never arrived.
   */
  it('discards a single wild outlier entirely', () => {
    const window = new MedianWindow(5);
    [110, 110.2, 55, 110.1, 109.9].forEach((v) => window.push(v));
    // Window is now [110.2, 55, 110.1, 109.9, 110]; the octave-down frame sorts to the end and
    // the middle element never notices it.
    expect(window.push(110)).toBeCloseTo(110, 5);
  });

  it('follows a genuine move once most of the window agrees', () => {
    const window = new MedianWindow(5);
    [110, 110, 110, 110, 110].forEach((v) => window.push(v));
    expect(window.push(220)).toBe(110);
    window.push(220);
    expect(window.push(220)).toBe(220);
  });

  it('slides rather than growing without bound', () => {
    const window = new MedianWindow(3);
    window.push(1);
    window.push(2);
    window.push(3);
    expect(window.push(100)).toBe(3);
  });

  it('forgets everything on reset', () => {
    const window = new MedianWindow(3);
    window.push(1);
    window.push(2);
    window.reset();
    expect(window.filled).toBe(false);
    expect(window.push(9)).toBeNull();
  });

  it('rejects even sizes, which would need averaging to find a middle', () => {
    expect(() => new MedianWindow(4)).toThrow();
    expect(() => new MedianWindow(0)).toThrow();
  });
});

describe('OneEuroFilter', () => {
  const feed = (filter: OneEuroFilter, values: number[], hz = 30) =>
    values.map((v, i) => filter.filter(v, i / hz));

  it('takes the first sample as-is, having nothing to smooth against', () => {
    expect(new OneEuroFilter().filter(42, 0)).toBe(42);
  });

  it('settles onto a constant', () => {
    const out = feed(new OneEuroFilter(), Array(60).fill(7));
    expect(out[out.length - 1]).toBeCloseTo(7, 3);
  });

  /*
   * The two properties that make this worth having over an exponential filter, and they pull
   * against each other: a string ringing at pitch jitters by a couple of cents and the needle must
   * not, while a peg turn moves hundreds of cents a second and the needle must keep up.
   */
  it('flattens the jitter of a string ringing steadily', () => {
    const jitter = Array.from({ length: 90 }, (_, i) => 3 + (i % 2 === 0 ? 1.5 : -1.5));
    const out = feed(new OneEuroFilter(), jitter).slice(30);
    const spread = Math.max(...out) - Math.min(...out);
    expect(spread).toBeLessThan(0.6); // input swings by 3.0
  });

  it('keeps up with a peg turn instead of lagging behind it', () => {
    // 300 cents per second, roughly how fast a peg moves under a hand.
    const ramp = Array.from({ length: 60 }, (_, i) => (i * 300) / 30);
    const out = feed(new OneEuroFilter(), ramp);
    const lag = ramp[ramp.length - 1] - out[out.length - 1];
    expect(lag).toBeLessThan(30); // under a tenth of a second behind
  });

  it('smooths harder at rest than it does mid-move, which a fixed cutoff cannot do', () => {
    const still = feed(new OneEuroFilter(), Array.from({ length: 60 }, (_, i) => (i % 2 ? 1 : -1)));
    const stillSpread = Math.max(...still.slice(30)) - Math.min(...still.slice(30));

    const moving = feed(new OneEuroFilter(), Array.from({ length: 60 }, (_, i) => i * 10));
    const movingStep = moving[59] - moving[58];

    expect(stillSpread).toBeLessThan(0.5); // 2.0 of input swing all but removed
    expect(movingStep).toBeGreaterThan(8); // yet a 10-per-frame move passes nearly whole
  });

  it('does not overshoot past a step', () => {
    const out = feed(new OneEuroFilter(), [...Array(20).fill(0), ...Array(40).fill(50)]);
    expect(Math.max(...out)).toBeLessThanOrEqual(50);
  });

  it('starts over after a reset', () => {
    const filter = new OneEuroFilter();
    feed(filter, Array(30).fill(100));
    filter.reset();
    expect(filter.filter(-20, 0)).toBe(-20);
  });

  it('degenerates to a plain exponential filter when beta is zero', () => {
    const ramp = Array.from({ length: 60 }, (_, i) => i * 10);
    const adaptiveLag = 590 - feed(new OneEuroFilter(), ramp)[59];
    const fixedLag = 590 - feed(new OneEuroFilter({ beta: 0 }), ramp)[59];
    // Both smooth the same amount at rest; only the adaptive one gets out of the way when the
    // value moves. That gap is the whole reason for choosing One Euro over an exponential filter.
    expect(fixedLag).toBeGreaterThan(adaptiveLag * 2);
  });
});
