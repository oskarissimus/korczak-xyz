import type { Card, GameState, Suit, Rank } from './types';

// Compact encoding: each card is 2 chars (rank + suit) + faceUp marker
// Suits: h=hearts, d=diamonds, c=clubs, s=spades
// Ranks: A,2,3,4,5,6,7,8,9,T,J,Q,K (T=10)
// FaceUp: uppercase = face up, lowercase = face down

const SUIT_CODES: Record<Suit, string> = {
  hearts: 'h',
  diamonds: 'd',
  clubs: 'c',
  spades: 's',
};

const CODE_TO_SUIT: Record<string, Suit> = {
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
  s: 'spades',
};

const RANK_CODES: Record<Rank, string> = {
  A: 'A', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7',
  '8': '8', '9': '9', '10': 'T', J: 'J', Q: 'Q', K: 'K',
};

const CODE_TO_RANK: Record<string, Rank> = {
  A: 'A', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7',
  '8': '8', '9': '9', T: '10', J: 'J', Q: 'Q', K: 'K',
};

function encodeCard(card: Card): string {
  const rank = RANK_CODES[card.rank];
  const suit = SUIT_CODES[card.suit];
  return card.faceUp ? `${rank}${suit.toUpperCase()}` : `${rank}${suit}`;
}

function decodeCard(code: string, id: string): Card {
  const rankCode = code[0];
  const suitCode = code[1].toLowerCase();
  const faceUp = code[1] === code[1].toUpperCase();

  return {
    id,
    rank: CODE_TO_RANK[rankCode],
    suit: CODE_TO_SUIT[suitCode],
    faceUp,
  };
}

function encodeCardArray(cards: Card[]): string {
  return cards.map(encodeCard).join('');
}

function decodeCardArray(encoded: string, prefix: string): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i < encoded.length; i += 2) {
    const code = encoded.slice(i, i + 2);
    const card = decodeCard(code, `${prefix}-${i / 2}`);
    // Reconstruct proper ID
    card.id = `${card.suit}-${card.rank}`;
    cards.push(card);
  }
  return cards;
}

export function encodeGameState(state: GameState): string {
  const parts: string[] = [];

  // Stock
  parts.push(encodeCardArray(state.stock));

  // Waste
  parts.push(encodeCardArray(state.waste));

  // Foundations (4 piles)
  for (const pile of state.foundations) {
    parts.push(encodeCardArray(pile));
  }

  // Tableau (7 columns)
  for (const column of state.tableau) {
    parts.push(encodeCardArray(column));
  }

  // Join with | separator, then base64 encode
  const joined = parts.join('|');
  return btoa(joined);
}

export function decodeGameState(encoded: string): GameState | null {
  try {
    const decoded = atob(encoded);
    const parts = decoded.split('|');

    if (parts.length !== 13) {
      return null;
    }

    const stock = decodeCardArray(parts[0], 'stock');
    const waste = decodeCardArray(parts[1], 'waste');

    const foundations: [Card[], Card[], Card[], Card[]] = [
      decodeCardArray(parts[2], 'f0'),
      decodeCardArray(parts[3], 'f1'),
      decodeCardArray(parts[4], 'f2'),
      decodeCardArray(parts[5], 'f3'),
    ];

    const tableau: [Card[], Card[], Card[], Card[], Card[], Card[], Card[]] = [
      decodeCardArray(parts[6], 't0'),
      decodeCardArray(parts[7], 't1'),
      decodeCardArray(parts[8], 't2'),
      decodeCardArray(parts[9], 't3'),
      decodeCardArray(parts[10], 't4'),
      decodeCardArray(parts[11], 't5'),
      decodeCardArray(parts[12], 't6'),
    ];

    return {
      stock,
      waste,
      foundations,
      tableau,
      moveCount: 0,
      startTime: null,
      gameWon: false,
    };
  } catch {
    return null;
  }
}

// Encode game state with full history for undo support
export function encodeGameWithHistory(state: GameState, history: GameState[]): string {
  const currentEncoded = encodeGameState(state);
  if (history.length === 0) {
    return currentEncoded;
  }
  const historyEncoded = history.map(h => encodeGameState(h));
  return [currentEncoded, ...historyEncoded].join('#');
}

// Decode game state with history, backwards compatible with old format
export function decodeGameWithHistory(encoded: string): { state: GameState; history: GameState[] } | null {
  try {
    // Check if it contains history (# separator)
    if (encoded.includes('#')) {
      const parts = encoded.split('#');
      const state = decodeGameState(parts[0]);
      if (!state) return null;

      const history: GameState[] = [];
      for (let i = 1; i < parts.length; i++) {
        const historyState = decodeGameState(parts[i]);
        if (historyState) {
          history.push(historyState);
        }
      }
      return { state, history };
    }

    // Legacy format: just game state, no history
    const state = decodeGameState(encoded);
    if (!state) return null;
    return { state, history: [] };
  } catch {
    return null;
  }
}
