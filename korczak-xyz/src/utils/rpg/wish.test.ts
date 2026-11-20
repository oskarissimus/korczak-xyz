import { describe, expect, it } from 'vitest';

import { wished } from './wish';

describe('wish', () => {
  it('leaves the world to the dice only when nothing is chosen', () => {
    expect(wished({ words: [], text: '   ' })).toBe(false);
    expect(wished({ words: [], text: 'pustynia' })).toBe(true);
    expect(wished({ words: ['śnieg'], text: '' })).toBe(true);
  });
});
