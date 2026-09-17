import { describe, expect, it } from 'vitest';

import { calculateCost, parseSceneBuffer, sceneSystemPrompt, targetWords } from './llm';

/*
 * `parseSceneBuffer` is the one piece of sloper that had to be written by hand rather than handed
 * to `JSON.parse`, and it is the piece the whole streaming screen stands on. Everything below is a
 * state the buffer genuinely passes through on the way to a finished array — a half-written key, a
 * brace inside a string, a comma before the next object — plus the two ways a model can answer
 * that are not the array it was asked for.
 */
describe('parseSceneBuffer', () => {
  it('finds nothing before the array opens', () => {
    expect(parseSceneBuffer('').scenes).toEqual([]);
    expect(parseSceneBuffer('Sure! Here are your scenes:').scenes).toEqual([]);
  });

  it('yields a scene the moment its object closes, before the array does', () => {
    const partial = '[{"script": "One.", "image_description": "A cat."}, {"script": "Tw';
    const { scenes } = parseSceneBuffer(partial);
    expect(scenes).toEqual([{ script: 'One.', image_description: 'A cat.' }]);
  });

  it('yields nothing for an object that has not closed', () => {
    expect(parseSceneBuffer('[{"script": "One.", "image_desc').scenes).toEqual([]);
  });

  /*
   * The reason this walks braces rather than counting them: an image description is prose written
   * by a model, and `{`, `}` and escaped quotes all turn up in prose. Counted naively, the first
   * brace inside a string closes the object one character early and the JSON never parses again.
   */
  it('is not fooled by braces or escaped quotes inside a string', () => {
    const buffer =
      '[{"script": "He said \\"hi {there}\\".", "image_description": "A sign reading {OPEN}"}]';
    expect(parseSceneBuffer(buffer).scenes).toEqual([
      { script: 'He said "hi {there}".', image_description: 'A sign reading {OPEN}' },
    ]);
  });

  it('is not fooled by a backslash before a quote-like character', () => {
    const buffer = '[{"script": "C:\\\\path\\\\", "image_description": "A folder"}]';
    expect(parseSceneBuffer(buffer).scenes).toEqual([
      { script: 'C:\\path\\', image_description: 'A folder' },
    ]);
  });

  it('reads the whole array and reports every scene each time it is called', () => {
    const buffer =
      '[{"script": "A", "image_description": "a"},{"script": "B", "image_description": "b"}]';
    // Called on every chunk over the whole buffer, so returning what it already returned is the
    // contract — callers slice past their own count.
    expect(parseSceneBuffer(buffer).scenes).toHaveLength(2);
    expect(parseSceneBuffer(buffer).scenes).toHaveLength(2);
  });

  it('skips an object that is not a scene rather than giving up on the buffer', () => {
    const buffer =
      '[{"note": "ignore me"},{"script": "A", "image_description": "a"}]';
    expect(parseSceneBuffer(buffer).scenes).toEqual([{ script: 'A', image_description: 'a' }]);
  });

  it('leaves the tail past the last complete scene as the remainder', () => {
    const buffer = '[{"script": "A", "image_description": "a"}, {"script": "B';
    expect(parseSceneBuffer(buffer).remainder).toBe(', {"script": "B');
  });
});

describe('sceneSystemPrompt', () => {
  /*
   * The prompt and the parser are one thing: the parser only ever finds objects with exactly
   * these two keys, so a prompt that stopped naming them would produce a stream nothing reads,
   * with no error anywhere.
   */
  it('names the two keys the parser looks for, and the counts', () => {
    const prompt = sceneSystemPrompt(6, 150);
    expect(prompt).toContain('"script"');
    expect(prompt).toContain('"image_description"');
    expect(prompt).toContain('exactly 6 scenes');
    expect(prompt).toContain('150 words');
  });
});

describe('targetWords', () => {
  it('is the same 2.5 words a second the cost estimate assumes', () => {
    expect(targetWords(60)).toBe(150);
    expect(targetWords(3)).toBe(8);
  });
});

describe('calculateCost', () => {
  it('prices a known model from the scraped rates', () => {
    // gpt-4o: $2.50 per million in, $10.00 per million out.
    expect(calculateCost('gpt-4o', { prompt: 1_000_000, completion: 0 })).toBeCloseTo(2.5, 6);
    expect(calculateCost('gpt-4o', { prompt: 0, completion: 1_000_000 })).toBeCloseTo(10, 6);
  });

  it('falls back to gpt-4o rather than to zero for a model it has never heard of', () => {
    // Reporting $0.0000 for a real spend is worse than reporting an approximation: one of them
    // looks like a free model and the other looks like an estimate, which it is.
    const made_up = calculateCost('gpt-9-ultra', { prompt: 1_000_000, completion: 0 });
    expect(made_up).toBeCloseTo(2.5, 6);
  });
});
