import type { Card, Suit } from './types';
import { getRankValue, isRed, isBlack } from './types';

/**
 * Check if a card can be placed on a foundation pile.
 * Foundations build up by suit from Ace to King.
 */
export function canPlaceOnFoundation(card: Card, pile: Card[], foundationIndex: number): boolean {
  const foundationSuits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
  const targetSuit = foundationSuits[foundationIndex];

  // Card must match the foundation's suit
  if (card.suit !== targetSuit) {
    return false;
  }

  if (pile.length === 0) {
    // Empty foundation: only Ace can be placed
    return card.rank === 'A';
  }

  // Card must be one rank higher than the top card
  const topCard = pile[pile.length - 1];
  return getRankValue(card.rank) === getRankValue(topCard.rank) + 1;
}

/**
 * Check if a card (or stack of cards) can be placed on a tableau column.
 * Tableau builds down in alternating colors.
 */
export function canPlaceOnTableau(cards: Card[], column: Card[]): boolean {
  if (cards.length === 0) return false;

  const bottomCard = cards[0];

  if (column.length === 0) {
    // Empty column: only King can be placed
    return bottomCard.rank === 'K';
  }

  // Get the top face-up card of the column
  const topCard = column[column.length - 1];
  if (!topCard.faceUp) return false;

  // Must be alternating colors
  const bottomIsRed = isRed(bottomCard.suit);
  const topIsRed = isRed(topCard.suit);
  if (bottomIsRed === topIsRed) return false;

  // Must be one rank lower
  return getRankValue(bottomCard.rank) === getRankValue(topCard.rank) - 1;
}

/**
 * Check if a stack of cards forms a valid descending sequence of alternating colors.
 */
export function isValidStack(cards: Card[]): boolean {
  if (cards.length <= 1) return true;

  for (let i = 1; i < cards.length; i++) {
    const prevCard = cards[i - 1];
    const currCard = cards[i];

    // All cards must be face up
    if (!currCard.faceUp) return false;

    // Must alternate colors
    if (isRed(prevCard.suit) === isRed(currCard.suit)) return false;

    // Must be descending by one rank
    if (getRankValue(currCard.rank) !== getRankValue(prevCard.rank) - 1) return false;
  }

  return true;
}

/**
 * Check if the game is won (all cards in foundations).
 */
export function checkWin(foundations: Card[][]): boolean {
  return foundations.every(pile => pile.length === 13);
}

/**
 * Get the index of the first face-up card in a tableau column.
 */
export function getFirstFaceUpIndex(column: Card[]): number {
  return column.findIndex(card => card.faceUp);
}

/**
 * Find which foundation a card should go to based on its suit.
 */
export function getFoundationIndexForSuit(suit: Suit): number {
  const suitOrder: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
  return suitOrder.indexOf(suit);
}
