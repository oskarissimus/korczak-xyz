import { describe, expect, it } from 'vitest';
import { bumpRevision, isAncestor, mergeWinner, reconcile, type SyncBookmark } from './reconcile';
import { createDefaultProgress, normalizeProgress, type TypingProgress } from './types';

const BOOK = 'krasnoludek';

// Build progress at a given position. `history` is filled with placeholder text so it stays
// index-aligned with passageIndex, which normalizeProgress requires.
function progress(overrides: Partial<TypingProgress> = {}): TypingProgress {
  const passageIndex = overrides.passageIndex ?? 0;
  return normalizeProgress({
    ...createDefaultProgress(BOOK),
    passageIndex,
    completedPassages: passageIndex,
    typedHistory: Array.from({ length: passageIndex }, (_, i) => `section ${i}\n`),
    totalKeystrokes: passageIndex * 100,
    ...overrides,
  });
}

// Progress carrying a usable revision identity.
function revised(rev: number, writerId: string, overrides: Partial<TypingProgress> = {}) {
  return progress({ rev, writerId, updatedAt: 1_000 + rev, ...overrides });
}

const base = (rev: number, writerId: string): SyncBookmark => ({ rev, writerId });

describe('reconcile', () => {
  describe('trivial cases', () => {
    it('seeds the cloud when no document exists and there is progress to send', () => {
      expect(reconcile(revised(3, 'A', { passageIndex: 5 }), null, null).kind).toBe('seed-cloud');
    });

    it('does nothing when no cloud document exists and there is nothing to send', () => {
      expect(reconcile(progress(), null, null).kind).toBe('in-sync');
    });

    it('adopts the cloud on a device with no local progress', () => {
      const decision = reconcile(progress(), revised(9, 'A', { passageIndex: 40 }), null);
      expect(decision.kind).toBe('adopt-cloud');
    });

    it('pushes when the cloud document exists but is empty', () => {
      expect(reconcile(revised(2, 'A', { passageIndex: 7 }), progress(), null).kind).toBe('push');
    });
  });

  describe('lineage', () => {
    it('is in sync when both sides hold the same revision', () => {
      const p = revised(5, 'A', { passageIndex: 12 });
      expect(reconcile(p, { ...p }, base(5, 'A')).kind).toBe('in-sync');
    });

    it('is in sync on the same revision even without a bookmark', () => {
      const p = revised(5, 'A', { passageIndex: 12 });
      expect(reconcile(p, { ...p }, null).kind).toBe('in-sync');
    });

    it('pushes when only local moved past the bookmark', () => {
      const local = revised(6, 'A', { passageIndex: 13 });
      const cloud = revised(5, 'A', { passageIndex: 12 });
      expect(reconcile(local, cloud, base(5, 'A')).kind).toBe('push');
    });

    it('pulls when only the cloud moved past the bookmark', () => {
      const local = revised(5, 'A', { passageIndex: 12 });
      const cloud = revised(2, 'B', { passageIndex: 30 });
      expect(reconcile(local, cloud, base(5, 'A')).kind).toBe('pull');
    });

    // The case a timestamp comparison gets wrong: two devices whose counters collide are
    // holding two different revisions, not the same one.
    it('does not treat equal revs from different writers as the same revision', () => {
      const local = revised(6, 'A', { passageIndex: 13 });
      const cloud = revised(6, 'B', { passageIndex: 20, typedHistory: [] });
      const decision = reconcile(local, cloud, base(5, 'A'));
      expect(decision.kind).toBe('conflict');
    });

    it('reports a conflict when both sides moved past the bookmark', () => {
      const local = revised(6, 'A', { passageIndex: 13, typedHistory: [] });
      const cloud = revised(9, 'B', { passageIndex: 11, typedHistory: [] });
      const decision = reconcile(local, cloud, base(5, 'A'));
      expect(decision.kind).toBe('conflict');
      expect(decision.suggested).toBe('local'); // 13 > 11
    });

    // A push that landed but whose bookmark write did not looks like divergence from the
    // bookmark alone; ancestry still resolves it without troubling the user.
    it('resolves a lost bookmark write by ancestry rather than conflict', () => {
      const cloud = revised(6, 'A', { passageIndex: 13 });
      const local = revised(7, 'A', { passageIndex: 14 });
      expect(reconcile(local, cloud, base(5, 'A')).kind).toBe('push');
    });
  });

  describe('legacy progress with no lineage', () => {
    it('pushes when the cloud is an ancestor of local', () => {
      const local = progress({ passageIndex: 20 });
      const cloud = progress({ passageIndex: 12 });
      expect(reconcile(local, cloud, null).kind).toBe('push');
    });

    it('pulls when local is an ancestor of the cloud', () => {
      const local = progress({ passageIndex: 12 });
      const cloud = progress({ passageIndex: 20 });
      expect(reconcile(local, cloud, null).kind).toBe('pull');
    });

    it('is in sync when the two are identical', () => {
      expect(reconcile(progress({ passageIndex: 12 }), progress({ passageIndex: 12 }), null).kind)
        .toBe('in-sync');
    });

    // Same position, different text typed into it - neither can be reached from the other.
    it('reports a conflict when the same section was typed differently', () => {
      const local = progress({ passageIndex: 12, typed: 'the quick brown' });
      const cloud = progress({ passageIndex: 12, typed: 'a slow green' });
      expect(reconcile(local, cloud, null).kind).toBe('conflict');
    });

    it('reports a conflict when completed sections disagree', () => {
      const local = progress({ passageIndex: 12 });
      const cloud = progress({ passageIndex: 20 });
      cloud.typedHistory[3] = 'typed something else\n';
      expect(reconcile(local, cloud, null).kind).toBe('conflict');
    });

    // Progress written before the lineage fields existed normalizes to writerId '', which is
    // not an identity - two such records must not be called the same revision.
    it('ignores lineage when either side predates it', () => {
      const local = progress({ passageIndex: 20 });
      const cloud = revised(4, 'B', { passageIndex: 12 });
      expect(reconcile(local, cloud, base(4, 'B')).kind).toBe('push');
    });
  });

  describe('conflict suggestion', () => {
    it('prefers the side further into the book', () => {
      const local = revised(2, 'A', { passageIndex: 5, typedHistory: [] });
      const cloud = revised(2, 'B', { passageIndex: 50, typedHistory: [] });
      expect(reconcile(local, cloud, base(1, 'A')).suggested).toBe('cloud');
    });

    it('falls back to how far into the current section each side is', () => {
      const local = revised(2, 'A', { passageIndex: 5, typed: 'abcdefgh' });
      const cloud = revised(2, 'B', { passageIndex: 5, typed: 'abx' });
      const decision = reconcile(local, cloud, base(1, 'A'));
      expect(decision.kind).toBe('conflict');
      expect(decision.suggested).toBe('local');
    });
  });
});

describe('isAncestor', () => {
  it('accepts a prefix of the current section', () => {
    expect(isAncestor(progress({ passageIndex: 4, typed: 'abc' }), progress({ passageIndex: 4, typed: 'abcdef' })))
      .toBe(true);
  });

  it('rejects a divergent prefix of the current section', () => {
    expect(isAncestor(progress({ passageIndex: 4, typed: 'abc' }), progress({ passageIndex: 4, typed: 'abx' })))
      .toBe(false);
  });

  it('rejects a candidate further along than its supposed descendant', () => {
    expect(isAncestor(progress({ passageIndex: 9 }), progress({ passageIndex: 4 }))).toBe(false);
  });

  it('rejects when the descendant recorded fewer keystrokes', () => {
    const a = progress({ passageIndex: 4, totalKeystrokes: 900 });
    const b = progress({ passageIndex: 6, totalKeystrokes: 100 });
    expect(isAncestor(a, b)).toBe(false);
  });

  it('requires the descendant to have finished the current section with the same text', () => {
    const a = progress({ passageIndex: 4, typed: 'hello' });
    const b = progress({ passageIndex: 6 });
    b.typedHistory[4] = 'goodbye\n';
    expect(isAncestor(a, b)).toBe(false);
  });

  it('tolerates absent history rather than treating it as a contradiction', () => {
    const a = progress({ passageIndex: 4, typed: '' });
    const b = progress({ passageIndex: 6, typedHistory: [] });
    expect(isAncestor(a, b)).toBe(true);
  });

  // Position and keystroke count alone are satisfiable by coincidence, so where divergence
  // is already suspected the claim has to be corroborated by the recorded text.
  it('refuses to infer ancestry from position alone when strict', () => {
    const a = progress({ passageIndex: 4, typed: '' });
    const b = progress({ passageIndex: 6, typedHistory: [] });
    expect(isAncestor(a, b, true)).toBe(false);
  });

  it('still confirms ancestry when strict and the history corroborates it', () => {
    expect(isAncestor(progress({ passageIndex: 4 }), progress({ passageIndex: 6 }), true))
      .toBe(true);
  });
});

describe('mergeWinner', () => {
  it('keeps the losing side\'s better lifetime WPM', () => {
    const winner = progress({ passageIndex: 10, bestWpm: 40 });
    const loser = progress({ passageIndex: 2, bestWpm: 62 });
    const merged = mergeWinner(winner, loser);
    expect(merged.bestWpm).toBe(62);
    expect(merged.passageIndex).toBe(10);
  });

  it('returns the winner untouched when it already holds the record', () => {
    const winner = progress({ passageIndex: 10, bestWpm: 70 });
    expect(mergeWinner(winner, progress({ bestWpm: 12 }))).toBe(winner);
  });
});

describe('bumpRevision', () => {
  it('increments the counter and claims the writer', () => {
    const next = bumpRevision(revised(4, 'A'), 'B', 5_000);
    expect(next.rev).toBe(5);
    expect(next.writerId).toBe('B');
    expect(next.updatedAt).toBe(5_000);
  });
});
