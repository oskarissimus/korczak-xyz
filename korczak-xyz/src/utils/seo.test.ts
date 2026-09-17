import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalPath, getPageSeo, isIndexable, SITE } from './seo';

describe('canonicalPath', () => {
  it('adds the trailing slash Cloudflare would otherwise 307 to', () => {
    expect(canonicalPath('/about')).toBe('/about/');
    expect(canonicalPath('/apps/anesthesia/admin')).toBe('/apps/anesthesia/admin/');
  });

  it('leaves an already-canonical path alone', () => {
    expect(canonicalPath('/about/')).toBe('/about/');
    expect(canonicalPath('/')).toBe('/');
  });

  it('resolves the built filename back to the URL it is served at', () => {
    expect(canonicalPath('/about/index.html')).toBe('/about/');
  });
});

describe('getPageSeo', () => {
  it('points an ordinary page at itself', () => {
    expect(getPageSeo('/about/', 'en').canonical).toBe(`${SITE}/about/`);
    expect(getPageSeo('/pl/about/', 'pl').canonical).toBe(`${SITE}/pl/about/`);
  });

  it('canonicalises a secondary app tab to its app root, in its own language', () => {
    expect(getPageSeo('/apps/transit/alerts/', 'en').canonical).toBe(`${SITE}/apps/transit/`);
    expect(getPageSeo('/pl/apps/transit/raw/', 'pl').canonical).toBe(`${SITE}/pl/apps/transit/`);
    expect(getPageSeo('/pl/apps/flashcards/neck/', 'pl').canonical).toBe(`${SITE}/pl/apps/flashcards/`);
  });

  it('never canonicalises an app root away from itself', () => {
    expect(getPageSeo('/apps/transit/', 'en').canonical).toBe(`${SITE}/apps/transit/`);
    expect(getPageSeo('/apps/events/', 'en').canonical).toBe(`${SITE}/apps/events/`);
  });

  it('pairs the two locales, with English as x-default', () => {
    const { alternates } = getPageSeo('/apps/tuner/', 'en');
    expect(alternates).toEqual([
      { hreflang: 'en', href: `${SITE}/apps/tuner/` },
      { hreflang: 'pl', href: `${SITE}/pl/apps/tuner/` },
      { hreflang: 'x-default', href: `${SITE}/apps/tuner/` },
    ]);
  });

  it('gives both locales of a page the same alternates', () => {
    expect(getPageSeo('/pl/songs/', 'pl').alternates).toEqual(getPageSeo('/songs/', 'en').alternates);
  });

  it('pairs the home pages without inventing a /pl//', () => {
    const { alternates } = getPageSeo('/', 'en');
    expect(alternates.map((a) => a.href)).toEqual([`${SITE}/`, `${SITE}/pl/`, `${SITE}/`]);
    expect(getPageSeo('/pl/', 'pl').canonical).toBe(`${SITE}/pl/`);
  });

  it('claims no alternate for the pages that have no Polish counterpart', () => {
    expect(getPageSeo('/offline/', 'en').alternates).toEqual([]);
    expect(getPageSeo('/404/', 'en').alternates).toEqual([]);
  });

  it('keeps the private pages out of the index, canonical to themselves', () => {
    for (const path of ['/login/', '/apps/anesthesia/admin/', '/apps/shopping/share/', '/apps/baby-sleep/share/']) {
      const seo = getPageSeo(path, 'en');
      expect(seo.noindex, path).toBe(true);
      // noindex plus a canonical pointing elsewhere is two contradictory instructions.
      expect(seo.canonical, path).toBe(SITE + path);
      expect(seo.alternates, path).toEqual([]);
    }
  });

  it('indexes the pages that carry the content', () => {
    for (const path of ['/', '/about/', '/blog/', '/songs/', '/courses/', '/apps/']) {
      expect(getPageSeo(path, 'en').noindex, path).toBe(false);
    }
  });
});

describe('isIndexable', () => {
  it('admits a self-canonical page and refuses a consolidated or private one', () => {
    expect(isIndexable('/apps/transit/')).toBe(true);
    expect(isIndexable('/pl/apps/transit/alerts/')).toBe(false);
    expect(isIndexable('/login/')).toBe(false);
  });
});

/**
 * Every route is built as `<path>/index.html` and Cloudflare 307s the unslashed form, so an
 * internal link without the trailing slash sends both the crawler and the reader through a
 * redirect. Two of them — the anesthesia admin link in each locale — are what put "Page with
 * redirect" in Search Console in September 2026, and nothing about writing one is obviously
 * wrong at the time, so the rule is checked rather than remembered.
 */
describe('internal links', () => {
  const pagesDir = new URL('../pages', import.meta.url).pathname;
  const srcDir = new URL('..', import.meta.url).pathname;

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  }

  it('all end in a slash', () => {
    const offenders: string[] = [];
    for (const file of walk(srcDir)) {
      if (!/\.(astro|tsx|ts|mdx)$/.test(file) || file.endsWith('.test.ts')) continue;
      const source = readFileSync(file, 'utf8');
      for (const [, href] of source.matchAll(/href="(\/[^"#?]*)"/g)) {
        // A file — an icon, a manifest, the logo — is a leaf and takes no slash.
        if (/\.[a-z0-9]+$/i.test(href)) continue;
        if (!href.endsWith('/')) offenders.push(`${file.replace(srcDir, 'src/')}: ${href}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('is looking at the pages it thinks it is', () => {
    expect(walk(pagesDir).length).toBeGreaterThan(50);
  });
});

describe('hreflang and canonical never contradict each other', () => {
  const routes = [
    '/', '/pl/', '/about/', '/apps/transit/', '/apps/transit/alerts/',
    '/pl/apps/transit/routes/', '/apps/flashcards/neck/', '/login/', '/offline/',
    '/apps/typing/stats/', '/pl/apps/baby-sleep/climate/', '/songs/',
  ];

  it('only annotates a page that is canonical to itself', () => {
    for (const path of routes) {
      const lang = path.startsWith('/pl/') ? 'pl' : 'en';
      const seo = getPageSeo(path, lang);
      if (seo.alternates.length > 0) {
        expect(seo.canonical, path).toBe(SITE + path);
      }
    }
  });

  it('names only self-canonical, indexable URLs in the annotations it does emit', () => {
    for (const path of routes) {
      const lang = path.startsWith('/pl/') ? 'pl' : 'en';
      for (const alt of getPageSeo(path, lang).alternates) {
        const target = alt.href.replace(SITE, '');
        expect(isIndexable(target), `${path} -> ${alt.href}`).toBe(true);
        const targetLang = target.startsWith('/pl/') ? 'pl' : 'en';
        expect(getPageSeo(target, targetLang).canonical, alt.href).toBe(alt.href);
      }
    }
  });
});
