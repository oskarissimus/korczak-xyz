/*
 * `sanitizeSettings` is the one part of storage worth testing on its own: it is pure, and it is
 * the only place a record from an older build — or from a newer one on another device — is made
 * safe before `scopeIds` reads it. Everything else in the module talks to `localStorage`, which
 * has no jsdom here to talk to.
 */

import { describe, expect, it } from 'vitest';
import { sanitizeSettings } from './storage';
import { DEFAULT_SETTINGS } from './types';

describe('sanitizeSettings', () => {
  it('fills in a setting a stored record was written before', () => {
    const settings = sanitizeSettings({ maxFret: 7 }, 'international');
    expect(settings.maxFret).toBe(7);
    expect(settings.notations).toEqual(['international']);
    expect(settings.directions).toEqual(DEFAULT_SETTINGS.directions);
  });

  it('starts a fresh record on the locale default', () => {
    expect(sanitizeSettings({}, 'german').notations).toEqual(['german']);
  });

  it('drops a notation this build has never heard of, and never lands on none', () => {
    expect(sanitizeSettings({ notations: ['klingon'] as never }, 'german').notations).toEqual([
      'german',
    ]);
    expect(sanitizeSettings({ notations: [] }, 'international').notations).toEqual([
      'international',
    ]);
    expect(
      sanitizeSettings({ notations: ['german', 'german'] }, 'international').notations
    ).toEqual(['german']);
  });

  describe('the record written when the notation was a display setting', () => {
    it('reads an international one as international', () => {
      const settings = sanitizeSettings({ notation: 'international' }, 'german');
      expect(settings.notations).toEqual(['international']);
    });

    it('reads a German one as both, so the deck it earnt stays in scope', () => {
      // Those cards carry plain ids, which are the international cards now — the setting never
      // reached an id and `ReviewEvent.answered` always stored international names. Migrating to
      // German alone would put the whole deck out of scope and start the player again at zero.
      const settings = sanitizeSettings({ notation: 'german' }, 'german');
      expect(settings.notations).toEqual(['international', 'german']);
    });

    it('does not carry the old field forward into what gets synced', () => {
      const settings = sanitizeSettings({ notation: 'german' }, 'german');
      expect(settings).not.toHaveProperty('notation');
    });

    it('is ignored once the new setting exists', () => {
      const settings = sanitizeSettings(
        { notation: 'german', notations: ['international'] },
        'german'
      );
      expect(settings.notations).toEqual(['international']);
    });
  });
});
