import { describe, expect, it } from 'vitest';
import { inboxPath, parseInboxPath, videoContentType } from './songVideoInbox';

describe('inboxPath', () => {
  it('files a recording under its song, newest-sortable, with a name storage will take', () => {
    expect(inboxPath('barka', 'IMG 4012 (1).MOV', 1760731200000)).toBe(
      'videoInbox/barka/1760731200000-IMG_4012_1_.MOV',
    );
  });

  it('refuses a slug the rules would refuse', () => {
    expect(() => inboxPath('Barka', 'a.mp4', 1)).toThrow();
    expect(() => inboxPath('../x', 'a.mp4', 1)).toThrow();
  });

  it('reads its own paths back, from either folder', () => {
    const path = inboxPath('sto-psot', 'take.mp4', 42);
    expect(parseInboxPath(path)).toEqual({ path, slug: 'sto-psot', uploadedAt: 42, fileName: 'take.mp4' });
    expect(parseInboxPath('videoFailed/sto-psot/42-take.mp4')?.slug).toBe('sto-psot');
    expect(parseInboxPath('users/abc/sloper/x.png')).toBeUndefined();
  });
});

describe('videoContentType', () => {
  it('keeps what the browser said, and calls an unnamed pick a video', () => {
    expect(videoContentType({ type: 'video/quicktime' })).toBe('video/quicktime');
    expect(videoContentType({ type: '' })).toBe('video/mp4');
  });
});
