import type { GameState } from '../types';

/**
 * Creates a canonical string representation of the game state for memoization.
 * Two states with the same hash are equivalent for solver purposes.
 *
 * The waste top card matters (it's the only playable card from stock/waste),
 * but the remaining stock+waste cards can be treated as an unordered set
 * since you'll cycle through all of them eventually.
 */
export function serializeState(state: GameState): string {
  // Foundation: just counts per pile (order within pile is always A->K)
  const foundations = state.foundations.map(f => f.length).join(',');

  // Tableau: encode each column with card IDs and face-up status
  const tableau = state.tableau.map(col =>
    col.map(c => `${c.id}:${c.faceUp ? 1 : 0}`).join('|')
  ).join(';');

  // Waste top card matters (it's the playable card)
  const wasteTop = state.waste.length > 0 ? state.waste[state.waste.length - 1].id : '';

  // Remaining stock + waste (excluding top) can be treated as unordered set
  const remainingCards = [
    ...state.stock.map(c => c.id),
    ...state.waste.slice(0, -1).map(c => c.id)
  ].sort().join(',');

  return `${foundations}#${tableau}#${wasteTop}#${remainingCards}`;
}

/**
 * Fast numeric hash for state comparison.
 * Uses FNV-1a hash algorithm for good distribution.
 */
export function hashState(state: GameState): number {
  const str = serializeState(state);
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Ring buffer transposition table for tracking visited states.
 * Uses FIFO eviction to maintain a fixed memory footprint while
 * keeping the most recent entries.
 */
export class TranspositionTable {
  private hashes: Uint32Array;    // Ring buffer of hashes
  private lookup: Set<number>;    // O(1) membership check
  private writeIndex: number;     // Next write position
  private count: number;          // Number of entries

  constructor(maxSize: number = 4000000) {
    this.hashes = new Uint32Array(maxSize);
    this.lookup = new Set();
    this.writeIndex = 0;
    this.count = 0;
  }

  has(hash: number): boolean {
    return this.lookup.has(hash);
  }

  add(hash: number): void {
    // Skip if already present
    if (this.lookup.has(hash)) return;

    // If at capacity, remove oldest entry (FIFO)
    if (this.count >= this.hashes.length) {
      const oldHash = this.hashes[this.writeIndex];
      this.lookup.delete(oldHash);
    } else {
      this.count++;
    }

    // Add new entry at write position
    this.hashes[this.writeIndex] = hash;
    this.lookup.add(hash);
    this.writeIndex = (this.writeIndex + 1) % this.hashes.length;
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.lookup.clear();
    this.writeIndex = 0;
    this.count = 0;
  }
}
