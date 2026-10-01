import { describe, expect, it } from 'vitest';

import { rideIdFor, roundPath } from './rideLog';

describe('where a round is saved', () => {
  it('is under the account, by ride and in order', () => {
    const rideId = rideIdFor(Date.UTC(2026, 9, 1, 11, 30, 5, 123));
    expect(rideId).toBe('2026-10-01T11-30-05-123Z');
    expect(roundPath('u1', { rideId, n: 7, at: 1759318205123 })).toBe(
      'users/u1/backseat/rides/2026-10-01T11-30-05-123Z/0007-1759318205123',
    );
  });
});
