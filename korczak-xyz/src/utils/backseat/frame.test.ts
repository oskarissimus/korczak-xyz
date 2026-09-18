import { describe, expect, it } from 'vitest';

import { FRAME_LONG_SIDE, base64Payload, classifyCameraError, fitWithin } from './frame';

/*
 * The size arithmetic is the only thing in the capture path that costs money: every pixel above
 * 512 is uploaded on somebody's mobile data and then discarded by the provider, which reads the
 * frame as one 512px tile whatever it is sent.
 */
describe('fitWithin', () => {
  it('scales a phone camera frame down to the long side', () => {
    expect(fitWithin(1920, 1080)).toEqual({ width: FRAME_LONG_SIDE, height: 288 });
    expect(fitWithin(1080, 1920)).toEqual({ width: 288, height: FRAME_LONG_SIDE });
  });

  /* Enlarging a small source uploads four times the bytes for exactly the same information. */
  it('never scales up', () => {
    expect(fitWithin(320, 240)).toEqual({ width: 320, height: 240 });
    expect(fitWithin(FRAME_LONG_SIDE, FRAME_LONG_SIDE)).toEqual({ width: 512, height: 512 });
  });

  it('keeps a square square and an extreme ratio at least one pixel tall', () => {
    expect(fitWithin(2000, 2000)).toEqual({ width: 512, height: 512 });
    // A canvas of zero height throws rather than producing an empty image.
    expect(fitWithin(4000, 3).height).toBeGreaterThanOrEqual(1);
  });

  it('gives nothing back for a source that has no size yet', () => {
    // What `videoWidth` reads as on a backgrounded iOS tab, which is an ordinary state.
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(Number.NaN, 100)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(-10, 100)).toEqual({ width: 0, height: 0 });
  });
});

/*
 * Google rejects the whole request if the data-URL prefix is left on, and the error it answers
 * with talks about the image rather than about the encoding.
 */
describe('base64Payload', () => {
  it('takes the prefix off a JPEG data URL', () => {
    expect(base64Payload('data:image/jpeg;base64,AAECAw==')).toBe('AAECAw==');
  });

  it('is empty for anything that is not base64', () => {
    expect(base64Payload('data:image/svg+xml,<svg/>')).toBe('');
    expect(base64Payload('https://example.com/a.jpg')).toBe('');
    expect(base64Payload('')).toBe('');
  });
});

/*
 * Each of these needs a different sentence from the person: one is a browser setting, one is a
 * different camera, one is another application. "The camera would not start" answers none of them.
 */
describe('classifyCameraError', () => {
  it('tells a refusal from a missing camera from a busy one', () => {
    expect(classifyCameraError({ name: 'NotAllowedError' })).toBe('denied');
    expect(classifyCameraError({ name: 'SecurityError' })).toBe('denied');
    expect(classifyCameraError({ name: 'NotFoundError' })).toBe('missing');
    // A laptop with no rear camera, which is the machine this is developed on.
    expect(classifyCameraError({ name: 'OverconstrainedError' })).toBe('missing');
    expect(classifyCameraError({ name: 'NotReadableError' })).toBe('busy');
  });

  it('falls back rather than throwing on anything else', () => {
    expect(classifyCameraError(new Error('boom'))).toBe('unknown');
    expect(classifyCameraError(null)).toBe('unknown');
    expect(classifyCameraError('nope')).toBe('unknown');
  });
});
