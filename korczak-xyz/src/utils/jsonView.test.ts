import { describe, expect, it } from 'vitest';
import { tokenizeJson, type JsonToken } from './jsonView';

const textOf = (tokens: JsonToken[]) => tokens.map((token) => token.text).join('');
const kindsOf = (tokens: JsonToken[], kind: string) =>
  tokens.filter((token) => token.kind === kind).map((token) => token.text);

describe('tokenizeJson', () => {
  it('reassembles into exactly what JSON.stringify produced', () => {
    // The property everything else rests on: colouring may not add, drop or reorder a character.
    const value = { a: 1, b: [true, null, 'x'], c: { d: -2.5e3 } };
    expect(textOf(tokenizeJson(value))).toBe(JSON.stringify(value, null, 2));
  });

  it('tells a key from a string by the colon that follows it', () => {
    const tokens = tokenizeJson({ title: 'title' });
    expect(kindsOf(tokens, 'key')).toEqual(['"title"']);
    expect(kindsOf(tokens, 'string')).toEqual(['"title"']);
  });

  it('does not read a literal out of the middle of a string', () => {
    // The reason the scan matches strings first. A scraped title is arbitrary text, and
    // `null`, `true` and a year in it are not JSON tokens.
    const tokens = tokenizeJson({ title: 'null true 2026' });
    expect(kindsOf(tokens, 'literal')).toEqual([]);
    expect(kindsOf(tokens, 'number')).toEqual([]);
    expect(kindsOf(tokens, 'string')).toEqual(['"null true 2026"']);
  });

  it('keeps an escaped quote inside the string it belongs to', () => {
    const tokens = tokenizeJson({ title: 'a "b" c' });
    expect(kindsOf(tokens, 'string')).toEqual(['"a \\"b\\" c"']);
  });

  it('separates numbers, literals and punctuation', () => {
    const tokens = tokenizeJson({ n: 12, ok: false, gone: null });
    expect(kindsOf(tokens, 'number')).toEqual(['12']);
    expect(kindsOf(tokens, 'literal')).toEqual(['false', 'null']);
    expect(kindsOf(tokens, 'punct').join('')).toContain('{');
  });

  it('says `undefined` rather than nothing', () => {
    // A blank panel where a field should be is the one output a reader cannot tell from a bug.
    expect(textOf(tokenizeJson(undefined))).toBe('undefined');
  });
});
