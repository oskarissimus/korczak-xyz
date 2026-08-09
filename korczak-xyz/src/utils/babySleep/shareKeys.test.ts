import { describe, expect, it } from 'vitest';

import { normalizeShareEmail, shareKeyFor } from './shareKeys';

describe('normalizeShareEmail', () => {
  it('lowercases and trims, because the security rule lowercases the token address', () => {
    // The whole scheme rests on this: `shares/{email}` is resolved by the rule from
    // `request.auth.token.email.lower()`, so an address stored with a capital in it is a grant that
    // can never be found and a share that silently does nothing.
    expect(normalizeShareEmail('  Gowecla@Gmail.COM ')).toEqual({
      email: 'gowecla@gmail.com',
      error: null,
    });
  });

  it('accepts an ordinary address', () => {
    expect(normalizeShareEmail('gowecla@gmail.com').email).toBe('gowecla@gmail.com');
  });

  it('rejects an empty box separately from a malformed one', () => {
    expect(normalizeShareEmail('   ').error).toBe('empty');
    expect(normalizeShareEmail('gowecla').error).toBe('malformed');
  });

  it('rejects what cannot be a document id', () => {
    // A slash would split the path, so the address could not be a document id at all.
    expect(normalizeShareEmail('a/b@gmail.com').error).toBe('malformed');
    expect(normalizeShareEmail('has space@gmail.com').error).toBe('malformed');
    expect(normalizeShareEmail('two@@gmail.com').error).toBe('malformed');
    expect(normalizeShareEmail('nodomain@gmail').error).toBe('malformed');
  });

  it('measures the id limit in bytes, not characters', () => {
    const ascii = `${'a'.repeat(1490)}@gmail.com`; // 1500 bytes exactly
    expect(normalizeShareEmail(ascii).error).toBe(null);
    expect(normalizeShareEmail(`a${ascii}`).error).toBe('too-long');
    // Each 'ż' is two bytes in UTF-8, so this is under the character count and over the byte one.
    expect(normalizeShareEmail(`${'ż'.repeat(800)}@gmail.com`).error).toBe('too-long');
  });

  it('refuses to share a log with its own owner', () => {
    // Otherwise `useDataOwner` resolves the owner's uid *through* their own share, and revoking it
    // later would take away their own log.
    expect(normalizeShareEmail('me@gmail.com', 'ME@gmail.com').error).toBe('self');
    expect(normalizeShareEmail('other@gmail.com', 'me@gmail.com').error).toBe(null);
  });

  it('ignores the owner check when the owner has no address', () => {
    expect(normalizeShareEmail('other@gmail.com', null).error).toBe(null);
    expect(normalizeShareEmail('other@gmail.com', undefined).error).toBe(null);
  });
});

describe('shareKeyFor', () => {
  it('matches what normalizeShareEmail stored, so a read finds a written share', () => {
    const written = normalizeShareEmail(' Gowecla@Gmail.com ');
    expect(shareKeyFor('GOWECLA@gmail.com ')).toBe(written.email);
  });

  it('is null for an account with no address, which can hold no share', () => {
    expect(shareKeyFor(null)).toBeNull();
    expect(shareKeyFor(undefined)).toBeNull();
    expect(shareKeyFor('  ')).toBeNull();
  });
});
