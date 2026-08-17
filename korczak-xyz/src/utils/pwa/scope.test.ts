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

  it('recognises the flashcards app and both its progress tabs', () => {
    expect(appForPath('/games/flashcards')).toBe('flashcards');
    expect(appForPath('/games/flashcards/neck')).toBe('flashcards');
    expect(appForPath('/games/flashcards/chords')).toBe('flashcards');
    expect(appForPath('/pl/games/flashcards/neck/')).toBe('flashcards');
  });

  it('recognises the baby sleep log and both its tabs', () => {
    expect(appForPath('/games/baby-sleep')).toBe('baby-sleep');
    expect(appForPath('/games/baby-sleep/stats')).toBe('baby-sleep');
    expect(appForPath('/games/baby-sleep/share')).toBe('baby-sleep');
    expect(appForPath('/pl/games/baby-sleep')).toBe('baby-sleep');
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
    expect(appForPath('/games/flashcards-old')).toBe('site');
  });

  it('keeps the two guitar apps apart', () => {
    // Neither claims the other: /games/tuner and /games/flashcards are siblings, and the one
    // listed later must not swallow the one listed first.
    expect(appForPath('/games/tuner')).toBe('tuner');
    expect(appForPath('/games/flashcards')).toBe('flashcards');
  });

  it('does not answer for the routes the merged app replaced', () => {
    // /games/fretboard and /games/transpose are 301s now (see public/_redirects) and belong to no
    // app: a page that still linked one would install the whole site under its name.
    expect(appForPath('/games/fretboard')).toBe('site');
    expect(appForPath('/games/transpose')).toBe('site');
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

  it('is false between the tabs of one app, so tab clicks stay soft navigations', () => {
    expect(crossesAppBoundary('/games/flashcards', '/games/flashcards/neck')).toBe(false);
    expect(crossesAppBoundary('/games/flashcards/neck', '/games/flashcards/chords')).toBe(false);
    expect(crossesAppBoundary('/games/baby-sleep/stats', '/games/baby-sleep/share')).toBe(false);
  });

  it('is true leaving an app for the games index it is listed on', () => {
    expect(crossesAppBoundary('/games/baby-sleep', '/games')).toBe(true);
    expect(crossesAppBoundary('/games/flashcards', '/games/tuner')).toBe(true);
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

  it('names one whose app id contains a hyphen, which the manifest route has to unpick', () => {
    expect(manifestIdentity('/games/baby-sleep')).toBe('baby-sleep-en');
    expect(manifestIdentity('/pl/games/baby-sleep/share')).toBe('baby-sleep-pl');
  });
});
