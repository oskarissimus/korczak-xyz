import { describe, expect, it } from 'vitest';

import { decideAccess, type AccessInputs } from './access';

const base: AccessInputs = {
  enabled: true,
  authResolved: true,
  cachedUid: null,
  identityUid: null,
  accountReady: false,
  approved: false,
};

describe('decideAccess', () => {
  it('is signed out when Firebase is not configured, whatever else is true', () => {
    expect(
      decideAccess({ ...base, enabled: false, identityUid: 'u1', accountReady: true, approved: true })
    ).toBe('signed-out');
  });

  it('waits before Firebase has spoken and there is no cache', () => {
    expect(decideAccess({ ...base, authResolved: false })).toBe('checking');
  });

  it('paints a cached account signed in before Firebase has spoken', () => {
    expect(decideAccess({ ...base, authResolved: false, cachedUid: 'u1' })).toBe('approved');
  });

  it('is signed out once Firebase says nobody is', () => {
    expect(decideAccess({ ...base, cachedUid: 'u1' })).toBe('signed-out');
  });

  it('is pending for a signed-in account with no row yet, or a row saying no', () => {
    expect(decideAccess({ ...base, identityUid: 'u1', accountReady: true })).toBe('pending');
  });

  it('is approved only when the row says so', () => {
    expect(
      decideAccess({ ...base, identityUid: 'u1', accountReady: true, approved: true })
    ).toBe('approved');
  });

  it('carries a matching cache over the gap while the row is read', () => {
    expect(decideAccess({ ...base, identityUid: 'u1', cachedUid: 'u1' })).toBe('approved');
  });

  it('does not carry another account’s cache over that gap', () => {
    expect(decideAccess({ ...base, identityUid: 'u2', cachedUid: 'u1' })).toBe('checking');
  });

  // The one that matters: a revoked account whose row has arrived must not be rescued by the
  // cache written while it was still approved.
  it('lets the arrived row beat a stale cache', () => {
    expect(
      decideAccess({ ...base, identityUid: 'u1', cachedUid: 'u1', accountReady: true, approved: false })
    ).toBe('pending');
  });
});
