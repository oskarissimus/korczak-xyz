import { describe, expect, it } from 'vitest';
import { headingChanged, headingFrom, HEADING_EPSILON_DEG } from './geo';

const event = (props: Record<string, unknown>) => props as unknown as DeviceOrientationEvent;

describe('headingFrom', () => {
  it('takes iOS’s true-north heading as it comes', () => {
    expect(headingFrom(event({ webkitCompassHeading: 90, alpha: 10 }))).toBe(90);
  });

  it('turns everyone else’s counter-clockwise alpha the right way round', () => {
    expect(headingFrom(event({ alpha: 90 }))).toBe(270);
    expect(headingFrom(event({ alpha: 0 }))).toBe(0);
  });

  it('reports nothing rather than a wrong bearing when the event carries neither', () => {
    expect(headingFrom(event({ alpha: null }))).toBeNull();
    expect(headingFrom(event({}))).toBeNull();
  });
});

describe('headingChanged', () => {
  it('always draws the first one', () => {
    expect(headingChanged(null, 0)).toBe(true);
  });

  it('ignores magnetometer jitter', () => {
    expect(headingChanged(180, 181)).toBe(false);
  });

  it('redraws on a real turn', () => {
    expect(headingChanged(180, 180 + HEADING_EPSILON_DEG)).toBe(true);
  });

  it('measures the short way round 0/360, not the long way', () => {
    expect(headingChanged(359, 0)).toBe(false);
    expect(headingChanged(359, 5)).toBe(true);
  });
});
