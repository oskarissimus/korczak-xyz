import { describe, expect, it } from 'vitest';
import {
  classifyNarrationFailure,
  NarrationError,
  parseSources,
  sourceLabel,
} from './narration';

const fail = (status: number, message = 'something') =>
  classifyNarrationFailure(new NarrationError(message, status));

describe('classifyNarrationFailure', () => {
  it('reads a 401 as the reader’s keys, missing or refused', () => {
    // The one failure the reader can fix on the spot; the app opens the keys sheet for it.
    expect(fail(401, 'No OpenAI key was sent')).toBe('keys');
    expect(fail(401, 'Failed to generate audio: ElevenLabs 401: Invalid API key')).toBe('keys');
  });

  it('does not send somebody to re-paste a key that is merely out of credit', () => {
    // ElevenLabs reports an exhausted quota as a 401, which the function passes on as one.
    expect(fail(401, 'Failed to generate audio: ElevenLabs 401: This request exceeds your quota')).toBe('quota');
  });

  it('reads a rate limit off the status', () => {
    expect(fail(429)).toBe('rate-limited');
  });

  it('digs an exhausted account out of the 502 everything else arrives as', () => {
    expect(fail(502, 'Failed to generate audio: ElevenLabs 402: This request exceeds your quota.')).toBe('quota');
    expect(fail(502, 'Failed to generate facts: OpenAI 429: You exceeded your current quota')).toBe('quota');
    expect(fail(502, 'billing hard limit reached')).toBe('quota');
  });

  it('finds a provider’s rate limit inside the same 502', () => {
    expect(fail(502, 'Failed to generate script: OpenAI 429: Rate limit reached')).toBe('rate-limited');
  });

  it('falls back rather than guessing, which is what the verbatim quote is for', () => {
    expect(fail(502, 'Failed to generate audio: upstream request failed')).toBe('failed');
    expect(fail(500, 'anything')).toBe('failed');
    expect(fail(418, 'teapot')).toBe('failed');
  });

  it('treats anything that is not one of ours as a plain failure', () => {
    expect(classifyNarrationFailure(new Error('network'))).toBe('failed');
    expect(classifyNarrationFailure('nope')).toBe('failed');
  });
});

describe('a place nothing is known about', () => {
  it('is told apart by its code, not by its wording', () => {
    expect(
      classifyNarrationFailure(new NarrationError('No sources found about this place', 422, 'no_sources')),
    ).toBe('no-sources');
    // A 422 without the code is somebody else's 422.
    expect(classifyNarrationFailure(new NarrationError('whatever', 422))).toBe('failed');
  });
});

describe('the sources header', () => {
  it('reads space-separated links and drops anything that is not one', () => {
    expect(
      parseSources(
        'https://pl.wikipedia.org/wiki/Pa%C5%82ac_Staszica  https://www.wikidata.org/wiki/Q1 javascript:alert(1) nonsense',
      ),
    ).toEqual(['https://pl.wikipedia.org/wiki/Pa%C5%82ac_Staszica', 'https://www.wikidata.org/wiki/Q1']);
    expect(parseSources(null)).toEqual([]);
    expect(parseSources('')).toEqual([]);
  });

  it('names each source by what it is', () => {
    expect(sourceLabel('https://pl.wikipedia.org/wiki/X')).toBe('Wikipedia (pl)');
    expect(sourceLabel('https://www.wikidata.org/wiki/Q1')).toBe('Wikidata');
    expect(sourceLabel('https://www.openstreetmap.org/way/1')).toBe('OpenStreetMap');
  });
});
