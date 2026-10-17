import { describe, expect, it } from 'vitest';
import { hasSongVideo, songVideo } from './songVideo';
import songVideos from '../data/songVideos.json';

describe('hasSongVideo', () => {
  it('finds a song by its entry in the manifest, with nothing in its body', () => {
    const slug = Object.keys(songVideos)[0];
    expect(songVideo(slug)?.file).toMatch(new RegExp(`^songs/${slug}\\.[0-9a-f]{8}$`));
    expect(hasSongVideo(slug, '```plaintext\nC G\n```')).toBe(true);
  });

  it('still finds a song embedded the old way', () => {
    expect(hasSongVideo('no-such-song', '<Youtube videoId="sJs4oyhh7P8" />')).toBe(true);
  });

  it('is not fooled by the word in the lyrics or a longer tag name', () => {
    expect(hasSongVideo('no-such-song', 'Video killed the radio star\n<VideoPlayer />')).toBe(false);
    expect(hasSongVideo('no-such-song', undefined)).toBe(false);
  });
});

describe('songVideos.json', () => {
  it('keys every entry by the slug its file is named after', () => {
    for (const [slug, entry] of Object.entries(songVideos)) {
      expect(entry.file.startsWith(`songs/${slug}.`)).toBe(true);
    }
  });
});
