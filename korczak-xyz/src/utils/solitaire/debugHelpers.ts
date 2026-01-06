import type { Card, GameState, Location, Suit, Rank } from './types';
import { SUIT_SYMBOLS, getRankValue } from './types';
import { canPlaceOnFoundation, canPlaceOnTableau, getFoundationIndexForSuit } from './rules';
import { applyMove } from './solver/moveGenerator';
import type { SolverMove } from './solver/types';

// Flexible location specification for console API
export type LocationSpec =
  | Location
  | 'stock'
  | 'waste'
  | `f${0 | 1 | 2 | 3}`
  | `t${0 | 1 | 2 | 3 | 4 | 5 | 6}`
  | `t${number}:${number}`
  | string;

// Flexible card specification
export type CardSpec = Card | string;

const SUIT_CODES: Record<string, Suit> = {
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
  s: 'spades',
};

const SUIT_CHARS: Record<Suit, string> = {
  hearts: 'h',
  diamonds: 'd',
  clubs: 'c',
  spades: 's',
};

/**
 * Parse a location shorthand string into a Location object.
 * Examples: 'stock', 'waste', 'f0', 't3', 't3:2'
 */
export function parseLocationSpec(spec: LocationSpec): Location | null {
  if (typeof spec === 'object' && spec !== null && 'zone' in spec) {
    return spec as Location;
  }

  if (typeof spec !== 'string') return null;

  const s = spec.toLowerCase().trim();

  if (s === 'stock') {
    return { zone: 'stock' };
  }

  if (s === 'waste') {
    return { zone: 'waste' };
  }

  // Foundation: f0, f1, f2, f3
  const foundationMatch = s.match(/^f([0-3])$/);
  if (foundationMatch) {
    return { zone: 'foundation', index: parseInt(foundationMatch[1], 10) };
  }

  // Tableau with card index: t3:2
  const tableauCardMatch = s.match(/^t([0-6]):(\d+)$/);
  if (tableauCardMatch) {
    return {
      zone: 'tableau',
      index: parseInt(tableauCardMatch[1], 10),
      cardIndex: parseInt(tableauCardMatch[2], 10),
    };
  }

  // Tableau column only: t3
  const tableauMatch = s.match(/^t([0-6])$/);
  if (tableauMatch) {
    return { zone: 'tableau', index: parseInt(tableauMatch[1], 10) };
  }

  return null;
}

/**
 * Parse a card shorthand string.
 * Examples: 'Ah' (Ace of hearts), 'Ks' (King of spades), '10d' (10 of diamonds)
 */
export function parseCardSpec(spec: CardSpec): { rank: Rank; suit: Suit } | null {
  if (typeof spec === 'object' && spec !== null && 'rank' in spec && 'suit' in spec) {
    return { rank: spec.rank, suit: spec.suit };
  }

  if (typeof spec !== 'string') return null;

  const s = spec.trim();
  if (s.length < 2) return null;

  // Handle 10 specially
  let rank: Rank;
  let suitChar: string;

  if (s.startsWith('10')) {
    rank = '10';
    suitChar = s.slice(2).toLowerCase();
  } else {
    rank = s[0].toUpperCase() as Rank;
    suitChar = s.slice(1).toLowerCase();
  }

  // Validate rank
  const validRanks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  if (!validRanks.includes(rank)) return null;

  // Parse suit
  const suit = SUIT_CODES[suitChar];
  if (!suit) return null;

  return { rank, suit };
}

/**
 * Find a card in the game state by its rank and suit.
 */
export function findCard(state: GameState, spec: CardSpec): Location | null {
  const parsed = parseCardSpec(spec);
  if (!parsed) return null;

  const { rank, suit } = parsed;
  const targetId = `${suit}-${rank}`;

  // Check stock
  const stockIdx = state.stock.findIndex(c => c.id === targetId);
  if (stockIdx !== -1) {
    return { zone: 'stock', cardIndex: stockIdx };
  }

  // Check waste
  const wasteIdx = state.waste.findIndex(c => c.id === targetId);
  if (wasteIdx !== -1) {
    return { zone: 'waste', cardIndex: wasteIdx };
  }

  // Check foundations
  for (let i = 0; i < 4; i++) {
    const foundationIdx = state.foundations[i].findIndex(c => c.id === targetId);
    if (foundationIdx !== -1) {
      return { zone: 'foundation', index: i, cardIndex: foundationIdx };
    }
  }

  // Check tableau
  for (let col = 0; col < 7; col++) {
    const cardIdx = state.tableau[col].findIndex(c => c.id === targetId);
    if (cardIdx !== -1) {
      return { zone: 'tableau', index: col, cardIndex: cardIdx };
    }
  }

  return null;
}

/**
 * Get the card at a specific location.
 */
export function getCardAt(state: GameState, spec: LocationSpec): Card | null {
  const loc = parseLocationSpec(spec);
  if (!loc) return null;

  switch (loc.zone) {
    case 'stock':
      if (loc.cardIndex !== undefined) {
        return state.stock[loc.cardIndex] ?? null;
      }
      return state.stock[state.stock.length - 1] ?? null;

    case 'waste':
      if (loc.cardIndex !== undefined) {
        return state.waste[loc.cardIndex] ?? null;
      }
      return state.waste[state.waste.length - 1] ?? null;

    case 'foundation':
      if (loc.index === undefined) return null;
      if (loc.cardIndex !== undefined) {
        return state.foundations[loc.index][loc.cardIndex] ?? null;
      }
      const foundation = state.foundations[loc.index];
      return foundation[foundation.length - 1] ?? null;

    case 'tableau':
      if (loc.index === undefined) return null;
      const column = state.tableau[loc.index];
      if (loc.cardIndex !== undefined) {
        return column[loc.cardIndex] ?? null;
      }
      return column[column.length - 1] ?? null;

    default:
      return null;
  }
}

/**
 * Format a card for display.
 */
function formatCard(card: Card | null, showFaceDown = true): string {
  if (!card) return '[ ]';
  if (!card.faceUp && showFaceDown) return '[##]';
  return `[${card.rank}${SUIT_CHARS[card.suit]}]`;
}

/**
 * Print the game state to console in ASCII art.
 */
export function printGameState(state: GameState, solvabilityStatus?: string): void {
  const lines: string[] = [];

  lines.push('');
  lines.push('=== Solitaire ===');

  // Status line
  const statusPart = solvabilityStatus ? ` | ${solvabilityStatus}` : '';
  lines.push(`Moves: ${state.moveCount}${statusPart}`);
  lines.push('');

  // Stock, Waste, and Foundations
  const stockStr = state.stock.length > 0 ? '[##]' : '[ ]';
  const wasteTop = state.waste.length > 0 ? state.waste[state.waste.length - 1] : null;
  const wasteStr = wasteTop ? formatCard(wasteTop) : '[ ]';

  lines.push(`STOCK [${state.stock.length}]   WASTE [${state.waste.length}]     FOUNDATIONS`);

  // Format foundations
  const foundationParts: string[] = [];
  const suitOrder: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
  for (let i = 0; i < 4; i++) {
    const pile = state.foundations[i];
    const symbol = SUIT_SYMBOLS[suitOrder[i]];
    if (pile.length === 0) {
      foundationParts.push(`[${symbol}]-`);
    } else {
      const top = pile[pile.length - 1];
      foundationParts.push(`[${symbol}]${top.rank}`);
    }
  }

  lines.push(`${stockStr}        ${wasteStr}          ${foundationParts.join('  ')}`);
  lines.push('');

  // Tableau
  lines.push('TABLEAU');
  lines.push(' 0     1     2     3     4     5     6');

  // Find max column height
  const maxHeight = Math.max(...state.tableau.map(col => col.length), 1);

  for (let row = 0; row < maxHeight; row++) {
    const rowParts: string[] = [];
    for (let col = 0; col < 7; col++) {
      const column = state.tableau[col];
      const card = column[row];
      if (card) {
        rowParts.push(formatCard(card).padEnd(5));
      } else {
        rowParts.push('     ');
      }
    }
    lines.push(rowParts.join(' '));
  }

  // Print all lines
  for (const line of lines) {
    console.log(line);
  }
}

/**
 * Execute a move from one location to another.
 * Returns the new game state or null if the move is invalid.
 */
export function executeDebugMove(
  state: GameState,
  fromSpec: LocationSpec,
  toSpec: LocationSpec,
  validate: boolean = true
): { newState: GameState; move: SolverMove } | null {
  const from = parseLocationSpec(fromSpec);
  const to = parseLocationSpec(toSpec);

  if (!from || !to) {
    console.warn('Invalid location specification');
    return null;
  }

  // Get the card(s) to move
  let cards: Card[] = [];
  let cardId: string | undefined;

  switch (from.zone) {
    case 'stock': {
      // When moving from stock, we treat it as pool move
      if (from.cardIndex !== undefined) {
        const card = state.stock[from.cardIndex];
        if (card) {
          cards = [card];
          cardId = card.id;
        }
      } else {
        // Default to top of stock
        const card = state.stock[state.stock.length - 1];
        if (card) {
          cards = [card];
          cardId = card.id;
        }
      }
      break;
    }

    case 'waste': {
      if (from.cardIndex !== undefined) {
        const card = state.waste[from.cardIndex];
        if (card) {
          cards = [card];
          cardId = card.id;
        }
      } else {
        const card = state.waste[state.waste.length - 1];
        if (card) {
          cards = [card];
          cardId = card.id;
        }
      }
      break;
    }

    case 'tableau': {
      if (from.index === undefined) return null;
      const column = state.tableau[from.index];
      const cardIndex = from.cardIndex ?? column.length - 1;
      cards = column.slice(cardIndex);
      if (cards.length === 0) {
        console.warn('No cards at that position');
        return null;
      }
      break;
    }

    case 'foundation': {
      // Moving from foundation (rare but possible for debugging)
      if (from.index === undefined) return null;
      const pile = state.foundations[from.index];
      const card = pile[pile.length - 1];
      if (card) {
        cards = [card];
        cardId = card.id;
      }
      break;
    }
  }

  if (cards.length === 0) {
    console.warn('No cards to move');
    return null;
  }

  // Validate the move if requested
  if (validate) {
    if (to.zone === 'foundation') {
      if (cards.length !== 1) {
        console.warn('Can only move one card to foundation');
        return null;
      }
      const foundationIdx = to.index ?? getFoundationIndexForSuit(cards[0].suit);
      if (!canPlaceOnFoundation(cards[0], state.foundations[foundationIdx], foundationIdx)) {
        console.warn('Invalid foundation move');
        return null;
      }
    } else if (to.zone === 'tableau') {
      if (to.index === undefined) return null;
      if (!canPlaceOnTableau(cards, state.tableau[to.index])) {
        console.warn('Invalid tableau move');
        return null;
      }
    }
  }

  // Build the solver move
  let move: SolverMove;

  if (from.zone === 'stock' || from.zone === 'waste') {
    if (to.zone === 'foundation') {
      move = {
        type: 'pool-to-foundation',
        from: { zone: 'waste', cardId },
        to: { zone: 'foundation', index: to.index ?? getFoundationIndexForSuit(cards[0].suit) },
      };
    } else {
      move = {
        type: 'pool-to-tableau',
        from: { zone: 'waste', cardId },
        to: { zone: 'tableau', index: to.index! },
      };
    }
  } else if (from.zone === 'tableau') {
    if (to.zone === 'foundation') {
      move = {
        type: 'tableau-to-foundation',
        from: { zone: 'tableau', index: from.index!, cardIndex: from.cardIndex ?? state.tableau[from.index!].length - 1 },
        to: { zone: 'foundation', index: to.index ?? getFoundationIndexForSuit(cards[0].suit) },
      };
    } else {
      move = {
        type: 'tableau-to-tableau',
        from: { zone: 'tableau', index: from.index!, cardIndex: from.cardIndex ?? state.tableau[from.index!].length - 1 },
        to: { zone: 'tableau', index: to.index! },
        cardCount: cards.length,
      };
    }
  } else if (from.zone === 'foundation') {
    // Moving from foundation to tableau (reverse move for debugging)
    if (to.zone !== 'tableau') {
      console.warn('Can only move foundation cards to tableau');
      return null;
    }

    // Manual state manipulation for this unusual case
    const newFoundations = [...state.foundations] as GameState['foundations'];
    newFoundations[from.index!] = state.foundations[from.index!].slice(0, -1);

    const newTableau = [...state.tableau] as GameState['tableau'];
    newTableau[to.index!] = [...state.tableau[to.index!], cards[0]];

    return {
      newState: {
        ...state,
        foundations: newFoundations,
        tableau: newTableau,
        moveCount: state.moveCount + 1,
      },
      move: {
        type: 'tableau-to-foundation', // Closest type, though reversed
        from: { zone: 'foundation', index: from.index! },
        to: { zone: 'tableau', index: to.index! },
      },
    };
  } else {
    console.warn('Invalid move type');
    return null;
  }

  // Apply the move
  const newState = applyMove(state, move);

  // Check if state actually changed
  if (newState === state) {
    console.warn('Move had no effect');
    return null;
  }

  return {
    newState: {
      ...newState,
      moveCount: state.moveCount + 1,
    },
    move,
  };
}

/**
 * Draw a card from stock to waste.
 */
export function executeStockDraw(state: GameState): GameState | null {
  if (state.stock.length === 0 && state.waste.length === 0) {
    console.warn('No cards in stock or waste');
    return null;
  }

  if (state.stock.length === 0) {
    // Recycle waste to stock
    const newStock = [...state.waste].reverse().map(c => ({ ...c, faceUp: false }));
    return {
      ...state,
      stock: newStock,
      waste: [],
      moveCount: state.moveCount + 1,
    };
  }

  // Draw from stock to waste
  const card = state.stock[state.stock.length - 1];
  return {
    ...state,
    stock: state.stock.slice(0, -1),
    waste: [...state.waste, { ...card, faceUp: true }],
    moveCount: state.moveCount + 1,
  };
}

/**
 * Format a SolverMove for display.
 */
export function formatMove(move: SolverMove): string {
  switch (move.type) {
    case 'pool-to-foundation':
      return `pool -> f${move.to?.index ?? '?'} (${move.from?.cardId ?? '?'})`;
    case 'pool-to-tableau':
      return `pool -> t${move.to?.index ?? '?'} (${move.from?.cardId ?? '?'})`;
    case 'tableau-to-foundation':
      return `t${move.from?.index ?? '?'}:${move.from?.cardIndex ?? '?'} -> f${move.to?.index ?? '?'}`;
    case 'tableau-to-tableau':
      return `t${move.from?.index ?? '?'}:${move.from?.cardIndex ?? '?'} -> t${move.to?.index ?? '?'} (${move.cardCount ?? 1} cards)`;
    default:
      return JSON.stringify(move);
  }
}
