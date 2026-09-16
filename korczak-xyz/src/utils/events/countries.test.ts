import { describe, expect, it } from 'vitest';
import { ONLINE, countryLabel } from './countries';

describe('countryLabel', () => {
  it('prints the code, and says so when there is none', () => {
    expect(countryLabel('PL')).toBe('PL');
    expect(countryLabel(ONLINE)).toBe('online');
    expect(countryLabel(undefined)).toBe('?');
  });
});

describe('ONLINE', () => {
  it('is not an ISO code, so it can never be mistaken for one in a list', () => {
    expect(ONLINE).not.toMatch(/^[A-Z]{2}$/);
  });
});
