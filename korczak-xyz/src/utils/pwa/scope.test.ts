import { describe, expect, it } from 'vitest';
import { appForPath, crossesAppBoundary, manifestIdentity } from './scope';

describe('appForPath', () => {
  it('recognises the tuner in both locales', () => {
    expect(appForPath('/games/tuner')).toBe('tuner');
    expect(appForPath('/games/tuner/')).toBe('tuner');
    expect(appForPath('/pl/games/tuner')).toBe('tuner');
  });

  it('recognises the songbook, index and detail alike', () => {
    expect(appForPath('/songs')).toBe('songs');
    expect(appForPath('/songs/warszawa')).toBe('songs');
    expect(appForPath('/pl/songs/arahja/')).toBe('songs');
  });

  it('treats everything else as the site', () => {
    expect(appForPath('/')).toBe('site');
    expect(appForPath('/games')).toBe('site');
    expect(appForPath('/blog/some-post')).toBe('site');
    expect(appForPath('/pl')).toBe('site');
  });

  it('does not match a path that merely starts with a scope name', () => {
    // /songs must not claim /songsheets, or that page would install as the songbook.
    expect(appForPath('/songsheets')).toBe('site');
    expect(appForPath('/games/tuner-old')).toBe('site');
  });
});

describe('crossesAppBoundary', () => {
  it('is true when leaving the site for an app, and back', () => {
    expect(crossesAppBoundary('/games', '/games/tuner')).toBe(true);
    expect(crossesAppBoundary('/games/tuner', '/about')).toBe(true);
  });

  it('is true between two different apps', () => {
    expect(crossesAppBoundary('/songs/warszawa', '/games/tuner')).toBe(true);
  });

  it('is false within the songbook, so clicking through songs stays a soft navigation', () => {
    expect(crossesAppBoundary('/songs', '/songs/warszawa')).toBe(false);
    expect(crossesAppBoundary('/songs/warszawa', '/songs/arahja')).toBe(false);
  });

  it('is false between ordinary pages', () => {
    expect(crossesAppBoundary('/', '/blog')).toBe(false);
  });

  it('counts a locale switch inside one app as a crossing, since the manifest differs', () => {
    // /songs links songs-en and /pl/songs links songs-pl: same app, different installable app.
    expect(appForPath('/songs')).toBe(appForPath('/pl/songs'));
    expect(crossesAppBoundary('/songs', '/pl/songs')).toBe(true);
    expect(crossesAppBoundary('/', '/pl')).toBe(true);
  });
});

describe('manifestIdentity', () => {
  it('names the manifest each path links', () => {
    expect(manifestIdentity('/games/tuner')).toBe('tuner-en');
    expect(manifestIdentity('/pl/games/tuner/')).toBe('tuner-pl');
    expect(manifestIdentity('/pl/songs/arahja')).toBe('songs-pl');
    expect(manifestIdentity('/about')).toBe('site-en');
  });
});
