import { describe, expect, it } from 'vitest';

import { CHOSEN_LEN, CHOSEN_MAX } from './genesis';
import { addWords, wished } from './wish';

describe('wish', () => {
  it('adds typed words one by one or comma by comma, without repeats, up to the limit', () => {
    expect(addWords([], 'kapelusz, piasek ,rewolwer')).toEqual(['kapelusz', 'piasek', 'rewolwer']);
    expect(addWords(['Kapelusz'], 'kapelusz; koń')).toEqual(['Kapelusz', 'koń']);
    expect(addWords([], '  ,  ')).toEqual([]);
    expect(addWords([], 'a,b,c,d,e,f,g,h')).toHaveLength(CHOSEN_MAX);
    expect(addWords([], 'x'.repeat(100))[0]).toHaveLength(CHOSEN_LEN);
  });

  it('leaves the world to the dice only when nothing is chosen', () => {
    expect(wished({ words: [], text: '   ' })).toBe(false);
    expect(wished({ words: [], text: 'pustynia' })).toBe(true);
    expect(wished({ words: ['śnieg'], text: '' })).toBe(true);
  });
});
