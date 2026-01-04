import type { Card, GameState, Suit } from '../types';
import { getRankValue, isRed } from '../types';
import { canPlaceOnFoundation, canPlaceOnTableau, getFoundationIndexForSuit } from '../rules';
import type { SolverMove } from './types';

const FOUNDATION_SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

/**
 * Check if moving a card to foundation is "safe" - meaning it can never be wrong.
 * Safe moves: Aces always, 2s when both opposite-color Aces are placed,
 * higher cards when both opposite-color (rank-1) cards are in foundations.
 */
export function isSafeFoundationMove(card: Card, state: GameState): boolean {
  const rank = getRankValue(card.rank);
  const cardIsRed = isRed(card.suit);

  // Aces are always safe to move to foundation
  if (rank === 1) return true;

  // Get the minimum rank in opposite-color foundations
  // Hearts (0) and Diamonds (1) are red, Clubs (2) and Spades (3) are black
  const oppositeFoundationIndices = cardIsRed ? [2, 3] : [0, 1];
  const minOppositeRank = Math.min(
    state.foundations[oppositeFoundationIndices[0]].length,
    state.foundations[oppositeFoundationIndices[1]].length
  );

  // Card is safe if both opposite-color foundations have at least (rank - 1)
  // This ensures no card in tableau needs this card for building
  return minOppositeRank >= rank - 1;
}

/**
 * Auto-play all safe foundation moves until no more are available.
 * Returns the resulting state after all safe moves are applied.
 */
export function autoPlaySafeMoves(state: GameState): GameState {
  let current = state;
  let changed = true;

  while (changed) {
    changed = false;

    // Check pool (stock + waste) for safe foundation moves
    const poolCards = [...current.stock, ...current.waste];
    for (const card of poolCards) {
      const foundationIdx = getFoundationIndexForSuit(card.suit);
      if (canPlaceOnFoundation(card, current.foundations[foundationIdx], foundationIdx) &&
          isSafeFoundationMove(card, current)) {
        // Find and remove card from pool
        const stockIdx = current.stock.findIndex(c => c.id === card.id);
        let newStock = current.stock;
        let newWaste = current.waste;

        if (stockIdx !== -1) {
          newStock = [...current.stock.slice(0, stockIdx), ...current.stock.slice(stockIdx + 1)];
        } else {
          const wasteIdx = current.waste.findIndex(c => c.id === card.id);
          if (wasteIdx !== -1) {
            newWaste = [...current.waste.slice(0, wasteIdx), ...current.waste.slice(wasteIdx + 1)];
          }
        }

        // Apply the move
        const newFoundations = [...current.foundations] as GameState['foundations'];
        newFoundations[foundationIdx] = [...newFoundations[foundationIdx], { ...card, faceUp: true }];
        current = {
          ...current,
          stock: newStock,
          waste: newWaste,
          foundations: newFoundations,
        };
        changed = true;
        break; // Restart loop to check for more safe moves
      }
    }

    // Check tableau tops for safe foundation moves
    for (let col = 0; col < 7; col++) {
      const column = current.tableau[col];
      if (column.length === 0) continue;

      const topCard = column[column.length - 1];
      if (!topCard.faceUp) continue;

      const foundationIdx = getFoundationIndexForSuit(topCard.suit);
      if (canPlaceOnFoundation(topCard, current.foundations[foundationIdx], foundationIdx) &&
          isSafeFoundationMove(topCard, current)) {
        // Apply the move
        const newFoundations = [...current.foundations] as GameState['foundations'];
        newFoundations[foundationIdx] = [...newFoundations[foundationIdx], { ...topCard, faceUp: true }];

        const newColumn = column.slice(0, -1);
        // Flip new top card if needed
        if (newColumn.length > 0 && !newColumn[newColumn.length - 1].faceUp) {
          newColumn[newColumn.length - 1] = { ...newColumn[newColumn.length - 1], faceUp: true };
        }

        const newTableau = [...current.tableau] as GameState['tableau'];
        newTableau[col] = newColumn;

        current = {
          ...current,
          tableau: newTableau,
          foundations: newFoundations,
        };
        changed = true;
        break; // Restart outer loop after modification
      }
    }
  }

  return current;
}

/**
 * Generate all legal moves from the current state.
 * Moves are returned in priority order for faster solution finding.
 * Includes symmetry reduction for empty columns.
 */
export function generateAllMoves(state: GameState): SolverMove[] {
  const foundationMoves: SolverMove[] = [];
  const revealingMoves: Array<{ move: SolverMove; faceDownCount: number }> = [];
  const wasteToTableauMoves: Array<{ move: SolverMove; toEmpty: boolean }> = [];
  const otherTableauMoves: SolverMove[] = [];

  // Find first empty column for symmetry reduction (all empty columns are equivalent)
  let firstEmptyColumn = -1;
  for (let col = 0; col < 7; col++) {
    if (state.tableau[col].length === 0) {
      firstEmptyColumn = col;
      break;
    }
  }

  // Priority 1: Moves to foundation (always beneficial)
  // From pool (stock + waste) - any card is playable since player can cycle infinitely
  const allPoolCards = [...state.stock, ...state.waste];
  for (const card of allPoolCards) {
    for (let i = 0; i < 4; i++) {
      if (canPlaceOnFoundation(card, state.foundations[i], i)) {
        foundationMoves.push({
          type: 'pool-to-foundation',
          from: { zone: 'waste', cardId: card.id },
          to: { zone: 'foundation', index: i },
        });
      }
    }
  }

  // From tableau
  for (let colIdx = 0; colIdx < 7; colIdx++) {
    const column = state.tableau[colIdx];
    if (column.length === 0) continue;
    const topCard = column[column.length - 1];
    if (!topCard.faceUp) continue;

    for (let i = 0; i < 4; i++) {
      if (canPlaceOnFoundation(topCard, state.foundations[i], i)) {
        foundationMoves.push({
          type: 'tableau-to-foundation',
          from: { zone: 'tableau', index: colIdx, cardIndex: column.length - 1 },
          to: { zone: 'foundation', index: i },
        });
      }
    }
  }

  // Priority 2: Tableau moves that reveal face-down cards
  for (let fromCol = 0; fromCol < 7; fromCol++) {
    const column = state.tableau[fromCol];
    const firstFaceUpIdx = column.findIndex(c => c.faceUp);
    if (firstFaceUpIdx === -1) continue;

    // Check if moving the first face-up card would reveal a face-down card
    const wouldReveal = firstFaceUpIdx > 0;

    if (wouldReveal) {
      const cardsToMove = column.slice(firstFaceUpIdx);
      const faceDownCount = firstFaceUpIdx; // Number of face-down cards in this column

      for (let toCol = 0; toCol < 7; toCol++) {
        if (toCol === fromCol) continue;

        // Symmetry reduction: for King moves to empty columns, only use first empty
        if (state.tableau[toCol].length === 0 && cardsToMove[0].rank === 'K') {
          if (toCol !== firstEmptyColumn) continue;
        }

        if (canPlaceOnTableau(cardsToMove, state.tableau[toCol])) {
          revealingMoves.push({
            move: {
              type: 'tableau-to-tableau',
              from: { zone: 'tableau', index: fromCol, cardIndex: firstFaceUpIdx },
              to: { zone: 'tableau', index: toCol },
              cardCount: cardsToMove.length,
            },
            faceDownCount,
          });
        }
      }
    }
  }

  // Priority 3: Pool (stock + waste) to tableau
  // Since player can cycle through stock infinitely, any card in pool is playable
  const poolCards = [...state.stock, ...state.waste];
  for (const card of poolCards) {
    for (let toCol = 0; toCol < 7; toCol++) {
      // Symmetry reduction: for King moves to empty columns, only use first empty
      if (state.tableau[toCol].length === 0 && card.rank === 'K') {
        if (toCol !== firstEmptyColumn) continue;
      }

      if (canPlaceOnTableau([card], state.tableau[toCol])) {
        wasteToTableauMoves.push({
          move: {
            type: 'pool-to-tableau',
            from: { zone: 'waste', cardId: card.id },
            to: { zone: 'tableau', index: toCol },
          },
          toEmpty: state.tableau[toCol].length === 0,
        });
      }
    }
  }

  // Priority 4: Tableau to tableau (that don't reveal cards - less valuable)
  for (let fromCol = 0; fromCol < 7; fromCol++) {
    const column = state.tableau[fromCol];
    const firstFaceUpIdx = column.findIndex(c => c.faceUp);
    if (firstFaceUpIdx === -1) continue;

    // Only consider moves that don't reveal (those that do were handled above)
    const wouldReveal = firstFaceUpIdx > 0;
    if (wouldReveal) continue;

    // Try moving different sized stacks
    for (let cardIdx = firstFaceUpIdx; cardIdx < column.length; cardIdx++) {
      const cardsToMove = column.slice(cardIdx);

      for (let toCol = 0; toCol < 7; toCol++) {
        if (toCol === fromCol) continue;

        // Skip moving king from empty column to another empty column (useless)
        if (cardIdx === 0 && state.tableau[toCol].length === 0) continue;

        // Symmetry reduction: for King moves to empty columns, only use first empty
        if (state.tableau[toCol].length === 0 && cardsToMove[0].rank === 'K') {
          if (toCol !== firstEmptyColumn) continue;
        }

        if (canPlaceOnTableau(cardsToMove, state.tableau[toCol])) {
          otherTableauMoves.push({
            type: 'tableau-to-tableau',
            from: { zone: 'tableau', index: fromCol, cardIndex: cardIdx },
            to: { zone: 'tableau', index: toCol },
            cardCount: cardsToMove.length,
          });
        }
      }
    }
  }

  // Note: Stock operations (stock-to-waste, recycle-waste) are no longer needed
  // since we treat stock+waste as a pool where any card is directly playable

  // Sort revealing moves: prefer columns with more face-down cards
  revealingMoves.sort((a, b) => b.faceDownCount - a.faceDownCount);

  // Sort waste-to-tableau: prefer non-empty destinations (preserve empty slots for kings)
  wasteToTableauMoves.sort((a, b) => (a.toEmpty ? 1 : 0) - (b.toEmpty ? 1 : 0));

  // Combine all moves in priority order
  return [
    ...foundationMoves,
    ...revealingMoves.map(r => r.move),
    ...wasteToTableauMoves.map(w => w.move),
    ...otherTableauMoves,
  ];
}

/**
 * Apply a move to a state and return the new state.
 * This creates a new state object (immutable).
 */
export function applyMove(state: GameState, move: SolverMove): GameState {
  switch (move.type) {
    case 'pool-to-foundation': {
      if (!move.from?.cardId || !move.to) return state;
      const cardId = move.from.cardId;
      const foundationIdx = move.to.index!;

      // Find and remove card from pool (either stock or waste)
      let card: Card | undefined;
      let newStock = state.stock;
      let newWaste = state.waste;

      const stockIdx = state.stock.findIndex(c => c.id === cardId);
      if (stockIdx !== -1) {
        card = state.stock[stockIdx];
        newStock = [...state.stock.slice(0, stockIdx), ...state.stock.slice(stockIdx + 1)];
      } else {
        const wasteIdx = state.waste.findIndex(c => c.id === cardId);
        if (wasteIdx !== -1) {
          card = state.waste[wasteIdx];
          newWaste = [...state.waste.slice(0, wasteIdx), ...state.waste.slice(wasteIdx + 1)];
        }
      }

      if (!card) return state;

      const newFoundations = [...state.foundations] as GameState['foundations'];
      newFoundations[foundationIdx] = [...newFoundations[foundationIdx], { ...card, faceUp: true }];
      return {
        ...state,
        stock: newStock,
        waste: newWaste,
        foundations: newFoundations,
      };
    }

    case 'pool-to-tableau': {
      if (!move.from?.cardId || !move.to) return state;
      const cardId = move.from.cardId;
      const toColIdx = move.to.index!;

      // Find and remove card from pool (either stock or waste)
      let card: Card | undefined;
      let newStock = state.stock;
      let newWaste = state.waste;

      const stockIdx = state.stock.findIndex(c => c.id === cardId);
      if (stockIdx !== -1) {
        card = state.stock[stockIdx];
        newStock = [...state.stock.slice(0, stockIdx), ...state.stock.slice(stockIdx + 1)];
      } else {
        const wasteIdx = state.waste.findIndex(c => c.id === cardId);
        if (wasteIdx !== -1) {
          card = state.waste[wasteIdx];
          newWaste = [...state.waste.slice(0, wasteIdx), ...state.waste.slice(wasteIdx + 1)];
        }
      }

      if (!card) return state;

      const newTableau = [...state.tableau] as GameState['tableau'];
      newTableau[toColIdx] = [...newTableau[toColIdx], { ...card, faceUp: true }];
      return {
        ...state,
        stock: newStock,
        waste: newWaste,
        tableau: newTableau,
      };
    }

    case 'tableau-to-foundation': {
      if (!move.from || !move.to) return state;
      const fromColIdx = move.from.index!;
      const fromColumn = [...state.tableau[fromColIdx]];
      const card = fromColumn.pop()!;

      // Flip new top card if needed
      if (fromColumn.length > 0 && !fromColumn[fromColumn.length - 1].faceUp) {
        fromColumn[fromColumn.length - 1] = { ...fromColumn[fromColumn.length - 1], faceUp: true };
      }

      const foundationIdx = move.to.index!;
      const newFoundations = [...state.foundations] as GameState['foundations'];
      newFoundations[foundationIdx] = [...newFoundations[foundationIdx], { ...card, faceUp: true }];

      const newTableau = [...state.tableau] as GameState['tableau'];
      newTableau[fromColIdx] = fromColumn;

      return {
        ...state,
        tableau: newTableau,
        foundations: newFoundations,
      };
    }

    case 'tableau-to-tableau': {
      if (!move.from || !move.to) return state;
      const fromColIdx = move.from.index!;
      const cardIdx = move.from.cardIndex!;
      const toColIdx = move.to.index!;

      const fromColumn = state.tableau[fromColIdx];
      const cardsToMove = fromColumn.slice(cardIdx);
      const remaining = fromColumn.slice(0, cardIdx);

      // Flip new top card if needed
      const newRemaining = [...remaining];
      if (newRemaining.length > 0 && !newRemaining[newRemaining.length - 1].faceUp) {
        newRemaining[newRemaining.length - 1] = { ...newRemaining[newRemaining.length - 1], faceUp: true };
      }

      const newTableau = [...state.tableau] as GameState['tableau'];
      newTableau[fromColIdx] = newRemaining;
      newTableau[toColIdx] = [...state.tableau[toColIdx], ...cardsToMove];

      return {
        ...state,
        tableau: newTableau,
      };
    }

    default:
      return state;
  }
}

/**
 * Check if game is won (all 52 cards in foundations).
 */
export function checkWin(state: GameState): boolean {
  return state.foundations.every(pile => pile.length === 13);
}

/**
 * Quick check if the game is definitely stuck (no legal moves possible).
 */
export function isDefinitelyStuck(state: GameState): boolean {
  // Check if any legal moves exist (includes pool moves)
  const moves = generateAllMoves(state);
  return moves.length === 0;
}

/**
 * Quick check if game is definitely winnable (all cards are accessible).
 * This is true when all face-down cards are revealed.
 * Note: Pool cards (stock+waste) are always accessible since we can cycle infinitely.
 */
export function isDefinitelyWinnable(state: GameState): boolean {
  // All tableau cards must be face-up
  for (const column of state.tableau) {
    for (const card of column) {
      if (!card.faceUp) return false;
    }
  }

  return true;
}
