import { describe, expect, it } from 'vitest';
import { CEILING, progressAt, stageAt, TOTAL_MS } from './progress';

describe('progressAt', () => {
  it('starts at nothing', () => {
    expect(progressAt(0)).toBe(0);
    expect(progressAt(-1)).toBe(0);
  });

  it('is linear in the middle', () => {
    expect(progressAt(TOTAL_MS / 2)).toBeCloseTo(0.5);
  });

  it('never claims to be finished while the audio is not here', () => {
    expect(progressAt(TOTAL_MS)).toBe(CEILING);
    expect(progressAt(TOTAL_MS * 10)).toBe(CEILING);
  });
});

describe('stageAt', () => {
  it('walks the four steps in order', () => {
    expect(stageAt(0)).toBe('researching');
    expect(stageAt(0.3)).toBe('writing');
    expect(stageAt(0.6)).toBe('speaking');
    expect(stageAt(0.9)).toBe('finishing');
  });

  it('stops at the last one rather than inventing a fifth', () => {
    expect(stageAt(CEILING)).toBe('finishing');
    expect(stageAt(1)).toBe('finishing');
  });
});
