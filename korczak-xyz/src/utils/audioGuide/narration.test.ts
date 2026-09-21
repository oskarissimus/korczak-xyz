import { describe, expect, it } from 'vitest';
import { classifyNarrationFailure, NarrationError } from './narration';

const fail = (status: number, message = 'something') =>
  classifyNarrationFailure(new NarrationError(message, status));

describe('classifyNarrationFailure', () => {
  it('knows the function’s own missing-keys answer from a provider failure', () => {
    // 500 is the Cloud Function's "Service configuration error" — its keys are unset, and no
    // amount of tapping again will help.
    expect(fail(500, 'Service configuration error')).toBe('config');
  });

  it('reads a rate limit off the status', () => {
    expect(fail(429)).toBe('rate-limited');
  });

  it('digs an exhausted account out of the 502 everything else arrives as', () => {
    expect(fail(502, 'ElevenLabs error 401: quota_exceeded')).toBe('quota');
    expect(fail(502, 'OpenAI error 429: insufficient_quota')).toBe('quota');
    expect(fail(502, 'billing hard limit reached')).toBe('quota');
  });

  it('finds a provider’s rate limit inside the same 502', () => {
    expect(fail(502, 'OpenAI error 429: Rate limit reached')).toBe('rate-limited');
  });

  it('falls back rather than guessing, which is what the verbatim quote is for', () => {
    expect(fail(502, 'Failed to generate audio')).toBe('failed');
    expect(fail(418, 'teapot')).toBe('failed');
  });

  it('treats anything that is not one of ours as a plain failure', () => {
    expect(classifyNarrationFailure(new Error('network'))).toBe('failed');
    expect(classifyNarrationFailure('nope')).toBe('failed');
  });
});
