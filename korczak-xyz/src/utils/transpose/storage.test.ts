import { describe, expect, it } from 'vitest';
import { sanitizeSettings } from './storage';
import { DEFAULT_SETTINGS } from './types';

const NOTATIONS = DEFAULT_SETTINGS.notations;

describe('sanitizeSettings', () => {
  it('leaves a record written before the ordering scope existed drawing both', () => {
    // The migration: no key for it means the spread over the defaults supplies both, so a deck
    // stored by the build that shipped the ordering axis is unchanged by this one.
    expect(sanitizeSettings({}, NOTATIONS).orders).toEqual(['degree', 'shuffled']);
  });

  it('keeps the orderings asked for, and never none', () => {
    expect(sanitizeSettings({ orders: ['degree'] }, NOTATIONS).orders).toEqual(['degree']);
    expect(sanitizeSettings({ orders: ['shuffled'] }, NOTATIONS).orders).toEqual(['shuffled']);
    expect(sanitizeSettings({ orders: [] }, NOTATIONS).orders).toEqual(DEFAULT_SETTINGS.orders);
    expect(sanitizeSettings({ orders: ['sorted'] as never }, NOTATIONS).orders).toEqual(
      DEFAULT_SETTINGS.orders
    );
  });

  it('keeps the two scope words', () => {
    expect(sanitizeSettings({ keys: 'all' }, NOTATIONS).keys).toBe('all');
    expect(sanitizeSettings({ keys: 'songbook' }, NOTATIONS).keys).toBe('songbook');
  });

  it('takes a list of keys, sorted and deduped', () => {
    // A set of keys, however it arrives: the panel builds one by toggling and another device may
    // have built the same one in a different order, and those are one scope rather than two.
    expect(sanitizeSettings({ keys: [9, 0, 9, 5] }, NOTATIONS).keys).toEqual([0, 5, 9]);
  });

  it('drops what is not a key at all', () => {
    expect(sanitizeSettings({ keys: [0, 12, -1, 1.5, 'C'] as never }, NOTATIONS).keys).toEqual([0]);
  });

  it('never lets the scope end up empty', () => {
    // The panel refuses to empty it; a record written by something else might not have.
    expect(sanitizeSettings({ keys: [] }, NOTATIONS).keys).toBe(DEFAULT_SETTINGS.keys);
    expect(sanitizeSettings({ keys: [99] as never }, NOTATIONS).keys).toBe(DEFAULT_SETTINGS.keys);
    expect(sanitizeSettings({ keys: 'every' as never }, NOTATIONS).keys).toBe(DEFAULT_SETTINGS.keys);
  });

  it('leaves a record written before the setting existed on the default', () => {
    expect(sanitizeSettings({}, NOTATIONS).keys).toBe(DEFAULT_SETTINGS.keys);
  });
});
