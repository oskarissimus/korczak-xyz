import { describe, expect, it } from 'vitest';
import { classicWorld } from './genesis';
import { musicPrompt, worldMusic } from './music';
import { MUSIC_MATCH_DEFAULT, MUSIC_RULES, bestMatch, cosine, musicQueryOf, musicWorldKey, thresholdOf } from './musicLibrary';

describe('the score library', () => {
  it('compares the world’s line, not the rules every track shares', () => {
    const world = classicWorld('en');
    const query = musicQueryOf(musicPrompt(world));
    expect(query).toBe(worldMusic(world));
    expect(query).not.toContain('Instrumental');
  });

  it('takes a quest’s mood off a prompt kept before one score a world', () => {
    const old = `slow dark folk, hurdy-gurdy. Mood: playful and light-footed, a little mischievous, with a wink. ${MUSIC_RULES}`;
    expect(musicQueryOf(old)).toBe('slow dark folk, hurdy-gurdy.');
  });

  it('scores by cosine and picks the closest track', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([1, 0], [1])).toBe(0);
    const items = [
      { id: 'a', embedding: [0, 1] },
      { id: 'b', embedding: [0.9, 0.1] },
    ];
    expect(bestMatch([1, 0], items)?.item.id).toBe('b');
    expect(bestMatch([1, 0], [])).toBeNull();
  });

  it('keeps the threshold to something that can mean good enough', () => {
    expect(thresholdOf(0.9)).toBe(0.9);
    expect(thresholdOf(0.2)).toBe(MUSIC_MATCH_DEFAULT);
    expect(thresholdOf('0.9')).toBe(MUSIC_MATCH_DEFAULT);
    expect(thresholdOf(undefined)).toBe(MUSIC_MATCH_DEFAULT);
  });

  it('names one account’s world as a document id', () => {
    expect(musicWorldKey('u1', 'w/1')).toBe('u1_w_1');
  });
});
