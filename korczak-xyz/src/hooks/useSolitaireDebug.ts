import { useEffect, useRef } from 'react';
import type { GameState, Location, Suit, Rank } from '../utils/solitaire/types';
import type { SolverMove } from '../utils/solitaire/solver/types';
import type { SolvabilityResult } from './useSolvabilityAnalysis';
import { encodeGameWithHistory, decodeGameWithHistory } from '../utils/solitaire/serialization';
import { generateAllMoves, autoPlaySafeMoves } from '../utils/solitaire/solver/moveGenerator';
import { solve } from '../utils/solitaire/solver';
import {
  parseLocationSpec,
  parseCardSpec,
  findCard,
  getCardAt,
  printGameState,
  executeDebugMove,
  executeStockDraw,
  formatMove,
  type LocationSpec,
  type CardSpec,
} from '../utils/solitaire/debugHelpers';

interface DebugHookParams {
  gameState: GameState;
  setGameState: React.Dispatch<React.SetStateAction<GameState>>;
  history: GameState[];
  setHistory: React.Dispatch<React.SetStateAction<GameState[]>>;
  setElapsedTime: React.Dispatch<React.SetStateAction<number>>;
  setSelectedLocation: React.Dispatch<React.SetStateAction<Location | null>>;
  solvabilityResult: SolvabilityResult;
  handleUndo: () => void;
  handleNewGame: () => void;
}

// Extend window interface
declare global {
  interface Window {
    solitaire?: SolitaireDebugAPI;
  }
}

export interface SolitaireDebugAPI {
  // State Inspection
  state: () => GameState;
  show: () => void;
  json: () => string;

  // History & Undo
  undo: () => boolean;
  history: () => GameState[];

  // Hints & Analysis
  hint: () => SolverMove | null;
  moves: () => SolverMove[];
  solvability: () => SolvabilityResult;
  debugSolve: () => string[];

  // Serialization
  copy: () => Promise<string>;
  paste: () => Promise<boolean>;
  encode: () => string;
  decode: (encoded: string) => boolean;

  // Move Execution
  move: (from: LocationSpec, to: LocationSpec) => boolean;
  forceMove: (from: LocationSpec, to: LocationSpec) => boolean;

  // Shortcuts
  draw: () => boolean;
  autoplay: () => boolean;

  // Game Control
  newGame: () => void;
  win: () => void;

  // Card Lookup
  find: (card: CardSpec) => Location | null;
  card: (location: LocationSpec) => import('../utils/solitaire/types').Card | null;

  // Help
  help: () => void;
}

function createDebugAPI(paramsRef: React.MutableRefObject<DebugHookParams>): SolitaireDebugAPI {
  // Helper to get current params
  const p = () => paramsRef.current;

  return {
    // State inspection
    state: () => p().gameState,

    show: () => {
      const { solvabilityResult } = p();
      printGameState(p().gameState, solvabilityResult.status);
    },

    json: () => JSON.stringify(p().gameState, null, 2),

    // History
    undo: () => {
      if (p().history.length > 0) {
        p().handleUndo();
        return true;
      }
      console.warn('No undo history available');
      return false;
    },

    history: () => p().history,

    // Analysis
    hint: () => {
      const { solvabilityResult, gameState } = p();
      if (solvabilityResult.firstWinningMove) {
        const move = solvabilityResult.firstWinningMove;
        console.log('Hint (winning move):', formatMove(move));
        return move;
      }
      const moves = generateAllMoves(gameState);
      if (moves.length > 0) {
        console.log('Hint:', formatMove(moves[0]));
        return moves[0];
      }
      console.log('No moves available');
      return null;
    },

    moves: () => {
      const moves = generateAllMoves(p().gameState);
      console.log(`${moves.length} moves available:`);
      moves.slice(0, 10).forEach((m, i) => {
        console.log(`  ${i + 1}. ${formatMove(m)}`);
      });
      if (moves.length > 10) {
        console.log(`  ... and ${moves.length - 10} more`);
      }
      return moves;
    },

    solvability: () => p().solvabilityResult,

    debugSolve: () => {
      const { gameState, history } = p();
      const result = solve(gameState, {}, undefined, undefined, undefined, history, true);
      const log = result.debugLog || [];
      console.log(`=== Solver Debug (${result.statesExplored} states, ${result.winnable ? 'winnable' : 'not winnable'}) ===`);
      log.forEach(line => console.log(line));
      return log;
    },

    // Serialization
    copy: async () => {
      const encoded = encodeGameWithHistory(p().gameState, p().history);
      try {
        await navigator.clipboard.writeText(encoded);
        console.log('Game copied to clipboard');
      } catch {
        console.warn('Could not copy to clipboard, returning encoded string');
      }
      return encoded;
    },

    paste: async () => {
      try {
        const text = await navigator.clipboard.readText();
        const decoded = decodeGameWithHistory(text);
        if (decoded) {
          p().setGameState(decoded.state);
          p().setHistory(decoded.history);
          p().setElapsedTime(0);
          p().setSelectedLocation(null);
          console.log('Game loaded from clipboard');
          return true;
        }
        console.warn('Invalid game data in clipboard');
        return false;
      } catch (e) {
        console.error('Failed to read clipboard:', e);
        return false;
      }
    },

    encode: () => encodeGameWithHistory(p().gameState, p().history),

    decode: (encoded: string) => {
      const decoded = decodeGameWithHistory(encoded);
      if (decoded) {
        p().setGameState(decoded.state);
        p().setHistory(decoded.history);
        p().setElapsedTime(0);
        p().setSelectedLocation(null);
        console.log('Game loaded');
        return true;
      }
      console.warn('Invalid game data');
      return false;
    },

    // Move execution
    move: (from: LocationSpec, to: LocationSpec) => {
      const { gameState, setGameState, setHistory } = p();
      const result = executeDebugMove(gameState, from, to, true);
      if (result) {
        // Save to history before applying move
        setHistory(prev => [...prev, gameState]);
        setGameState(result.newState);
        console.log('Move executed:', formatMove(result.move));
        return true;
      }
      return false;
    },

    forceMove: (from: LocationSpec, to: LocationSpec) => {
      const { gameState, setGameState, setHistory } = p();
      const result = executeDebugMove(gameState, from, to, false);
      if (result) {
        setHistory(prev => [...prev, gameState]);
        setGameState(result.newState);
        console.log('Force move executed:', formatMove(result.move));
        return true;
      }
      return false;
    },

    // Shortcuts
    draw: () => {
      const { gameState, setGameState, setHistory } = p();
      const newState = executeStockDraw(gameState);
      if (newState) {
        setHistory(prev => [...prev, gameState]);
        setGameState(newState);
        if (gameState.stock.length === 0) {
          console.log('Recycled waste to stock');
        } else {
          console.log('Drew card from stock');
        }
        return true;
      }
      return false;
    },

    autoplay: () => {
      const { gameState, setGameState, setHistory } = p();
      const newState = autoPlaySafeMoves(gameState);
      if (newState !== gameState) {
        setHistory(prev => [...prev, gameState]);
        setGameState({
          ...newState,
          moveCount: gameState.moveCount + 1,
        });
        console.log('Autoplayed safe moves');
        return true;
      }
      console.log('No safe moves to autoplay');
      return false;
    },

    // Game control
    newGame: () => {
      p().handleNewGame();
      console.log('New game started');
    },

    win: () => {
      const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
      const ranks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      const foundations = suits.map(suit =>
        ranks.map(rank => ({ id: `${suit}-${rank}`, suit, rank, faceUp: true }))
      ) as GameState['foundations'];

      p().setGameState(prev => ({
        ...prev,
        foundations,
        tableau: [[], [], [], [], [], [], []] as GameState['tableau'],
        stock: [],
        waste: [],
        gameWon: true,
      }));
      console.log('Win state triggered');
    },

    // Card lookup
    find: (card: CardSpec) => {
      const location = findCard(p().gameState, card);
      if (location) {
        console.log(`Found at: ${location.zone}${location.index !== undefined ? `[${location.index}]` : ''}${location.cardIndex !== undefined ? `:${location.cardIndex}` : ''}`);
      } else {
        console.log('Card not found');
      }
      return location;
    },

    card: (location: LocationSpec) => {
      const card = getCardAt(p().gameState, location);
      if (card) {
        console.log(`Card: ${card.rank} of ${card.suit} (${card.faceUp ? 'face up' : 'face down'})`);
      } else {
        console.log('No card at that location');
      }
      return card;
    },

    // Help
    help: () => {
      console.log(`
=== Solitaire Debug Console ===

State Inspection:
  solitaire.show()              - Print ASCII game board
  solitaire.state()             - Get raw GameState object
  solitaire.json()              - Get state as JSON string

Undo/History:
  solitaire.undo()              - Undo last move
  solitaire.history()           - Get history array

Hints & Analysis:
  solitaire.hint()              - Get recommended move
  solitaire.moves()             - List all legal moves
  solitaire.solvability()       - Get solvability analysis

Copy/Paste:
  solitaire.copy()              - Copy game to clipboard
  solitaire.paste()             - Load game from clipboard
  solitaire.encode()            - Get encoded string
  solitaire.decode(str)         - Load from encoded string

Move Execution:
  solitaire.move(from, to)      - Execute validated move
  solitaire.forceMove(from, to) - Skip validation

  Location formats:
    'stock', 'waste'            - Stock/waste pile
    'f0' to 'f3'                - Foundation piles
    't0' to 't6'                - Tableau columns (top card)
    't3:2'                      - Tableau column 3, card at index 2

  Examples:
    solitaire.move('waste', 't3')
    solitaire.move('t2:4', 'f0')
    solitaire.move('t0', 't6')

Shortcuts:
  solitaire.draw()              - Draw from stock
  solitaire.autoplay()          - Auto-play safe foundation moves

Game Control:
  solitaire.newGame()           - Start new game
  solitaire.win()               - Trigger win (debug)

Card Lookup:
  solitaire.find('Kh')          - Find King of hearts
  solitaire.find('10d')         - Find 10 of diamonds
  solitaire.card('t3')          - Get card at tableau 3
  solitaire.card('waste')       - Get top waste card
`);
    },
  };
}

export function useSolitaireDebug(params: DebugHookParams): void {
  // Use refs to always have latest values without recreating API
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    const api = createDebugAPI(paramsRef);

    // Expose to window
    window.solitaire = api;

    // Log availability
    console.log(
      '%c[Solitaire Debug] %cConsole API available at window.solitaire',
      'color: #4CAF50; font-weight: bold',
      'color: inherit'
    );
    console.log('Type solitaire.help() for available commands');

    return () => {
      delete window.solitaire;
    };
  }, []);
}
