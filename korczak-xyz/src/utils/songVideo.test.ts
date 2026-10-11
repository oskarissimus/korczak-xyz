import { describe, expect, it } from 'vitest';
import { hasSongVideo } from './songVideo';

describe('hasSongVideo', () => {
  it('finds the songbook video component', () => {
    expect(hasSongVideo('<Video youtubeId="sJs4oyhh7P8" />')).toBe(true);
  });

  it('still finds a song embedded the old way', () => {
    expect(hasSongVideo('<Youtube videoId="sJs4oyhh7P8" />')).toBe(true);
  });

  it('is not fooled by the word in the lyrics or a longer tag name', () => {
    expect(hasSongVideo('Video killed the radio star\n<VideoPlayer />')).toBe(false);
    expect(hasSongVideo(undefined)).toBe(false);
  });
});
