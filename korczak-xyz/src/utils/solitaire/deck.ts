import type { Card, GameState, Suit, Rank } from './types';
import { SUITS, RANKS } from './types';

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `${suit}-${rank}`,
        suit,
        rank,
        faceUp: false,
      });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealCards(): GameState {
  const deck = shuffleDeck(createDeck());

  const tableau: [Card[], Card[], Card[], Card[], Card[], Card[], Card[]] = [
    [], [], [], [], [], [], []
  ];

  let cardIndex = 0;

  // Deal tableau: column 0 gets 1 card, column 1 gets 2 cards, etc.
  for (let col = 0; col < 7; col++) {
    for (let row = 0; row <= col; row++) {
      const card = { ...deck[cardIndex] };
      // Only the top card of each column is face up
      card.faceUp = row === col;
      tableau[col].push(card);
      cardIndex++;
    }
  }

  // Remaining cards go to stock (face down)
  const stock = deck.slice(cardIndex).map(card => ({ ...card, faceUp: false }));

  return {
    stock,
    waste: [],
    foundations: [[], [], [], []],
    tableau,
    moveCount: 0,
    startTime: null,
    gameWon: false,
  };
}

export function createInitialState(): GameState {
  return dealCards();
}
