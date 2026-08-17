import { describe, expect, it } from 'vitest';
import { languages, type Lang } from '../../i18n';
import { PWA_APPS, manifestPath, parseManifestParam, scope, startUrl } from './apps';
import { appForPath, type PwaApp } from './scope';

const apps = Object.keys(PWA_APPS) as PwaApp[];
const langs = Object.keys(languages) as Lang[];

describe('parseManifestParam', () => {
  it('round-trips every manifest the route generates', () => {
    for (const app of apps) {
      for (const lang of langs) {
        const param = manifestPath(app, lang).replace('/manifests/', '').replace('.webmanifest', '');
        expect(parseManifestParam(param)).toEqual({ app, lang });
      }
    }
  });

  it('splits at the last hyphen, so a hyphenated app id survives', () => {
    // split('-') would read this as the app `baby`, which is in neither PWA_APPS nor the
    // registry — the route would then serve a manifest of undefined names under a valid URL.
    expect(parseManifestParam('baby-sleep-en')).toEqual({ app: 'baby-sleep', lang: 'en' });
    expect(parseManifestParam('baby-sleep-pl')).toEqual({ app: 'baby-sleep', lang: 'pl' });
  });
});

describe('the app registry', () => {
  it('gives every app a start URL that scope.ts agrees belongs to it', () => {
    // The two halves are separate on purpose — apps.ts stays out of the browser — so nothing
    // but this stops a new app declaring a path scope.ts has never heard of, which would make
    // the manifest claim a scope its own start URL falls outside.
    for (const app of apps) {
      for (const lang of langs) {
        expect(appForPath(startUrl(app, lang))).toBe(app);
      }
    }
  });

  it('scopes each app to its own start URL, and only the site to the whole origin', () => {
    for (const app of apps) {
      for (const lang of langs) {
        expect(scope(app, lang)).toBe(app === 'site' ? '/' : startUrl(app, lang));
      }
    }
  });

  it('localises the start URL, so /pl installs the Polish app', () => {
    expect(startUrl('flashcards', 'en')).toBe('/games/flashcards');
    expect(startUrl('flashcards', 'pl')).toBe('/pl/games/flashcards');
    expect(startUrl('baby-sleep', 'pl')).toBe('/pl/games/baby-sleep');
    expect(startUrl('site', 'en')).toBe('/');
  });
});
