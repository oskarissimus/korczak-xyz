import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameControls } from './GameControls';
import { Stock } from './Stock';
import { Waste } from './Waste';
import { Foundation } from './Foundation';
import { Tableau } from './Tableau';
import { WinDialog } from './WinDialog';
import { WinAnimation } from './WinAnimation';
import { DragPreview } from './DragPreview';
import { AutosolveAnimation } from './AutosolveAnimation';
import { dealCards } from '../../utils/solitaire/deck';
import { canPlaceOnFoundation, canPlaceOnTableau, checkWin, getFoundationIndexForSuit, areAllCardsFaceUp } from '../../utils/solitaire/rules';
import { encodeGameWithHistory, decodeGameWithHistory } from '../../utils/solitaire/serialization';
import { generateAllMoves } from '../../utils/solitaire/solver/moveGenerator';
import { useSolvabilityAnalysis } from '../../hooks/useSolvabilityAnalysis';
import { useSolitaireDebug } from '../../hooks/useSolitaireDebug';
import type { GameState, Card, Location, Move } from '../../utils/solitaire/types';
import type { SolverMove } from '../../utils/solitaire/solver/types';

interface TouchDragState {
  sourceLocation: Location;
  cards: Card[];
  startPosition: { x: number; y: number };
  currentPosition: { x: number; y: number };
  offset: { x: number; y: number };
  isDragging: boolean;
}

const DRAG_THRESHOLD = 10; // pixels to move before considered a drag

interface SolitaireProps {
  lang: 'en' | 'pl';
}

const translations = {
  en: {
    newGame: 'New Game',
    undo: 'Undo',
    hint: 'Hint',
    copy: 'Copy',
    paste: 'Paste',
    autosolve: 'Autosolve',
    moves: 'Moves',
    time: 'Time',
    youWin: 'You Win!',
    playAgain: 'Play Again',
    analyzing: 'Analyzing...',
    winnable: 'Winnable',
    stuck: 'Stuck',
    unknown: 'Unknown',
    confirmNewGame: 'Start a new game?',
    confirmNewGameMessage: 'Your current progress will be lost.',
    confirm: 'Yes',
    cancel: 'No',
    copied: 'Game copied to clipboard',
    loaded: 'Game loaded from clipboard',
    invalidPaste: 'Invalid game data',
  },
  pl: {
    newGame: 'Nowa Gra',
    undo: 'Cofnij',
    hint: 'Podpowiedz',
    copy: 'Kopiuj',
    paste: 'Wklej',
    autosolve: 'Rozwiaz',
    moves: 'Ruchy',
    time: 'Czas',
    youWin: 'Wygrales!',
    playAgain: 'Zagraj Ponownie',
    analyzing: 'Analizuje...',
    winnable: 'Do wygrania',
    stuck: 'Zablokowana',
    unknown: 'Nieznane',
    confirmNewGame: 'Rozpoczac nowa gre?',
    confirmNewGameMessage: 'Obecny postep zostanie utracony.',
    confirm: 'Tak',
    cancel: 'Nie',
    copied: 'Gra skopiowana',
    loaded: 'Gra wczytana',
    invalidPaste: 'Nieprawidlowe dane gry',
  },
};

// localStorage persistence
const STORAGE_KEY = 'solitaire-game-state';

interface PersistedState {
  gameState: GameState;
  history: GameState[];
  savedAt: number;
}

function saveGameState(gameState: GameState, history: GameState[]): void {
  try {
    const data: PersistedState = {
      gameState,
      history,
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors (private browsing, quota exceeded)
  }
}

function loadGameState(): PersistedState | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    return JSON.parse(data) as PersistedState;
  } catch {
    return null;
  }
}

function clearGameState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

function initializeState(): { gameState: GameState; history: GameState[]; initialElapsedTime: number } {
  const saved = loadGameState();

  if (saved && !saved.gameState.gameWon) {
    // Calculate elapsed time including time since last save
    let initialElapsedTime = 0;
    if (saved.gameState.startTime) {
      const elapsedBeforeSave = saved.savedAt - saved.gameState.startTime;
      const elapsedSinceSave = Date.now() - saved.savedAt;
      initialElapsedTime = Math.floor((elapsedBeforeSave + elapsedSinceSave) / 1000);
    }

    return {
      gameState: saved.gameState,
      history: saved.history,
      initialElapsedTime,
    };
  }

  return {
    gameState: dealCards(),
    history: [],
    initialElapsedTime: 0,
  };
}

export default function Solitaire({ lang }: SolitaireProps) {
  const t = translations[lang];

  // Initialize from localStorage or start new game
  const [initialData] = useState(() => initializeState());
  const [gameState, setGameState] = useState<GameState>(initialData.gameState);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [dragSource, setDragSource] = useState<Location | null>(null);
  const [elapsedTime, setElapsedTime] = useState(initialData.initialElapsedTime);
  const [history, setHistory] = useState<GameState[]>(initialData.history);
  const [showWinAnimation, setShowWinAnimation] = useState(false);
  const [showWinDialog, setShowWinDialog] = useState(false);
  const [showNewGameConfirm, setShowNewGameConfirm] = useState(false);
  const [touchDrag, setTouchDrag] = useState<TouchDragState | null>(null);
  const [highlightedDropTarget, setHighlightedDropTarget] = useState<Location | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [hintMove, setHintMove] = useState<SolverMove | null>(null);
  const [isAutosolving, setIsAutosolving] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const hintTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Solvability analysis
  const solvabilityResult = useSolvabilityAnalysis(
    gameState,
    !gameState.gameWon // Disable analysis when game is won
  );

  // Timer effect
  useEffect(() => {
    if (gameState.startTime && !gameState.gameWon) {
      const interval = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [gameState.startTime, gameState.gameWon]);

  // Save game state to localStorage
  useEffect(() => {
    if (!gameState.gameWon) {
      saveGameState(gameState, history);
    }
  }, [gameState, history]);

  // Trigger win animation when game is won
  useEffect(() => {
    if (gameState.gameWon && !showWinAnimation && !showWinDialog) {
      setShowWinAnimation(true);
    }
  }, [gameState.gameWon, showWinAnimation, showWinDialog]);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleWinAnimationComplete = useCallback(() => {
    // Keep animation visible (trails persist), just show dialog on top
    setShowWinDialog(true);
  }, []);

  // Test win animation with keyboard shortcut (Ctrl+Shift+W)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'W') {
        e.preventDefault();
        const suits: Array<'hearts' | 'diamonds' | 'clubs' | 'spades'> = ['hearts', 'diamonds', 'clubs', 'spades'];
        const ranks: Array<'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'> = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const foundations = suits.map(suit =>
          ranks.map(rank => ({ id: `${suit}-${rank}`, suit, rank, faceUp: true }))
        ) as GameState['foundations'];
        setGameState(prev => ({
          ...prev,
          foundations,
          tableau: [[], [], [], [], [], [], []] as GameState['tableau'],
          stock: [],
          waste: [],
          gameWon: true,
        }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const startGameIfNeeded = useCallback((state: GameState): GameState => {
    if (!state.startTime) {
      return { ...state, startTime: Date.now() };
    }
    return state;
  }, []);

  const saveToHistory = useCallback((state: GameState) => {
    setHistory(prev => [...prev, state]);
  }, []);

  const handleNewGameRequest = useCallback(() => {
    // If game hasn't started or is won, start new game immediately
    if (!gameState.startTime || gameState.gameWon) {
      clearGameState();
      setGameState(dealCards());
      setSelectedLocation(null);
      setElapsedTime(0);
      setHistory([]);
      setShowWinAnimation(false);
      setShowWinDialog(false);
    } else {
      // Show confirmation dialog
      setShowNewGameConfirm(true);
    }
  }, [gameState.startTime, gameState.gameWon]);

  const handleNewGameConfirm = useCallback(() => {
    clearGameState();
    setGameState(dealCards());
    setSelectedLocation(null);
    setElapsedTime(0);
    setHistory([]);
    setShowWinAnimation(false);
    setShowWinDialog(false);
    setShowNewGameConfirm(false);
  }, []);

  const handleNewGameCancel = useCallback(() => {
    setShowNewGameConfirm(false);
  }, []);

  const handleUndo = useCallback(() => {
    if (history.length > 0) {
      const prevState = history[history.length - 1];
      setGameState(prevState);
      setHistory(prev => prev.slice(0, -1));
      setSelectedLocation(null);
    }
  }, [history]);

  const handleCopy = useCallback(async () => {
    try {
      const encoded = encodeGameWithHistory(gameState, history);
      await navigator.clipboard.writeText(encoded);
      setToast({ message: t.copied, type: 'success' });
    } catch {
      setToast({ message: t.invalidPaste, type: 'error' });
    }
  }, [gameState, history, t]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const decoded = decodeGameWithHistory(text);
      if (decoded) {
        setGameState(decoded.state);
        setElapsedTime(0);
        setHistory(decoded.history);
        setSelectedLocation(null);
        setToast({ message: t.loaded, type: 'success' });
      } else {
        setToast({ message: t.invalidPaste, type: 'error' });
      }
    } catch {
      setToast({ message: t.invalidPaste, type: 'error' });
    }
  }, [t]);

  const clearHint = useCallback(() => {
    if (hintTimeoutRef.current) {
      clearTimeout(hintTimeoutRef.current);
      hintTimeoutRef.current = null;
    }
    setHintMove(null);
  }, []);

  const handleHint = useCallback(() => {
    // Clear any existing hint
    clearHint();

    // Use the solver's winning move if available (ensures hint leads to a win)
    if (solvabilityResult.firstWinningMove) {
      setHintMove(solvabilityResult.firstWinningMove);
      // Auto-clear hint after 3 seconds
      hintTimeoutRef.current = setTimeout(() => {
        setHintMove(null);
      }, 3000);
      return;
    }

    // Fallback to generateAllMoves if solver hasn't completed or game is in unknown state
    const moves = generateAllMoves(gameState);
    if (moves.length > 0) {
      // Take the first (highest priority) move
      setHintMove(moves[0]);
      // Auto-clear hint after 3 seconds
      hintTimeoutRef.current = setTimeout(() => {
        setHintMove(null);
      }, 3000);
    }
  }, [gameState, clearHint, solvabilityResult.firstWinningMove]);

  const handleAutosolve = useCallback(() => {
    if (!areAllCardsFaceUp(gameState) || gameState.gameWon || isAutosolving) return;
    saveToHistory(gameState);
    setIsAutosolving(true);
    setSelectedLocation(null);
  }, [gameState, isAutosolving, saveToHistory]);

  const handleAutosolveStateUpdate = useCallback((newState: GameState) => {
    setGameState(newState);
  }, []);

  const handleAutosolveComplete = useCallback((finalState: GameState) => {
    setIsAutosolving(false);
    // Trigger win
    setGameState(prev => ({
      ...finalState,
      gameWon: true,
    }));
  }, []);

  // Clear hint when game state changes (user made a move)
  useEffect(() => {
    clearHint();
  }, [gameState, clearHint]);

  // Cleanup hint timeout on unmount
  useEffect(() => {
    return () => {
      if (hintTimeoutRef.current) {
        clearTimeout(hintTimeoutRef.current);
      }
    };
  }, []);

  // Copy/paste keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (e.key === 'c') {
          e.preventDefault();
          handleCopy();
        } else if (e.key === 'v') {
          e.preventDefault();
          handlePaste();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCopy, handlePaste]);

  // Debug console API
  useSolitaireDebug({
    gameState,
    setGameState,
    history,
    setHistory,
    setElapsedTime,
    setSelectedLocation,
    solvabilityResult,
    handleUndo,
    handleNewGame: handleNewGameConfirm,
  });

  const handleStockClick = useCallback(() => {
    setGameState(prev => {
      const state = startGameIfNeeded(prev);
      saveToHistory(prev);

      if (state.stock.length === 0) {
        // Reset stock from waste
        if (state.waste.length === 0) return state;
        return {
          ...state,
          stock: [...state.waste].reverse().map(c => ({ ...c, faceUp: false })),
          waste: [],
        };
      }

      // Draw one card from stock to waste
      const card = state.stock[state.stock.length - 1];
      return {
        ...state,
        stock: state.stock.slice(0, -1),
        waste: [...state.waste, { ...card, faceUp: true }],
      };
    });
    setSelectedLocation(null);
  }, [startGameIfNeeded, saveToHistory]);

  const tryMoveToFoundation = useCallback((card: Card, fromLocation: Location, state: GameState): GameState | null => {
    const foundationIndex = getFoundationIndexForSuit(card.suit);
    if (canPlaceOnFoundation(card, state.foundations[foundationIndex], foundationIndex)) {
      const newFoundations = [...state.foundations] as GameState['foundations'];
      newFoundations[foundationIndex] = [...newFoundations[foundationIndex], { ...card, faceUp: true }];

      let newState: GameState;

      if (fromLocation.zone === 'waste') {
        newState = {
          ...state,
          waste: state.waste.slice(0, -1),
          foundations: newFoundations,
          moveCount: state.moveCount + 1,
        };
      } else if (fromLocation.zone === 'tableau' && fromLocation.index !== undefined) {
        const newTableau = [...state.tableau] as GameState['tableau'];
        const column = [...newTableau[fromLocation.index]];
        column.pop();
        // Flip the new top card if needed
        if (column.length > 0 && !column[column.length - 1].faceUp) {
          column[column.length - 1] = { ...column[column.length - 1], faceUp: true };
        }
        newTableau[fromLocation.index] = column;
        newState = {
          ...state,
          tableau: newTableau,
          foundations: newFoundations,
          moveCount: state.moveCount + 1,
        };
      } else {
        return null;
      }

      // Check for win
      if (checkWin(newState.foundations)) {
        newState.gameWon = true;
      }

      return newState;
    }
    return null;
  }, []);

  const handleWasteClick = useCallback(() => {
    if (gameState.waste.length === 0) return;

    const topCard = gameState.waste[gameState.waste.length - 1];
    const fromLocation: Location = { zone: 'waste' };

    if (selectedLocation?.zone === 'waste') {
      // Double-click behavior: try to auto-move to foundation
      const newState = tryMoveToFoundation(topCard, fromLocation, startGameIfNeeded(gameState));
      if (newState) {
        saveToHistory(gameState);
        setGameState(newState);
        setSelectedLocation(null);
        return;
      }
    }

    setSelectedLocation(fromLocation);
  }, [gameState, selectedLocation, startGameIfNeeded, tryMoveToFoundation, saveToHistory]);

  const handleTableauCardClick = useCallback((columnIndex: number, cardIndex: number) => {
    const column = gameState.tableau[columnIndex];
    const card = column[cardIndex];

    if (!card.faceUp) return;

    const clickedLocation: Location = { zone: 'tableau', index: columnIndex, cardIndex };

    // If clicking the same card that's selected, try to auto-move to foundation (only single card)
    if (
      selectedLocation?.zone === 'tableau' &&
      selectedLocation.index === columnIndex &&
      selectedLocation.cardIndex === cardIndex &&
      cardIndex === column.length - 1 // Only auto-move if it's the top card
    ) {
      const newState = tryMoveToFoundation(card, clickedLocation, startGameIfNeeded(gameState));
      if (newState) {
        saveToHistory(gameState);
        setGameState(newState);
        setSelectedLocation(null);
        return;
      }
    }

    // If we have a selection, try to move
    if (selectedLocation) {
      const cardsToMove = getSelectedCards();
      if (cardsToMove && canPlaceOnTableau(cardsToMove, column)) {
        saveToHistory(gameState);
        setGameState(prev => {
          const state = startGameIfNeeded(prev);
          return moveCards(state, selectedLocation, { zone: 'tableau', index: columnIndex });
        });
        setSelectedLocation(null);
        return;
      }
    }

    // Select this card (and all cards below it)
    setSelectedLocation(clickedLocation);
  }, [gameState, selectedLocation, startGameIfNeeded, tryMoveToFoundation, saveToHistory]);

  const handleTableauDrop = useCallback((columnIndex: number) => {
    if (!dragSource) return;

    const cardsToMove = getDraggedCards();
    if (!cardsToMove) return;

    const column = gameState.tableau[columnIndex];

    if (canPlaceOnTableau(cardsToMove, column)) {
      saveToHistory(gameState);
      setGameState(prev => {
        const state = startGameIfNeeded(prev);
        return moveCards(state, dragSource, { zone: 'tableau', index: columnIndex });
      });
    }

    setDragSource(null);
    setSelectedLocation(null);
  }, [dragSource, gameState, startGameIfNeeded, saveToHistory]);

  const handleFoundationDrop = useCallback((foundationIndex: number) => {
    if (!dragSource) return;

    const cardsToMove = getDraggedCards();
    if (!cardsToMove || cardsToMove.length !== 1) return;

    const card = cardsToMove[0];
    if (canPlaceOnFoundation(card, gameState.foundations[foundationIndex], foundationIndex)) {
      saveToHistory(gameState);
      setGameState(prev => {
        let state = startGameIfNeeded(prev);
        state = moveCards(state, dragSource, { zone: 'foundation', index: foundationIndex });
        if (checkWin(state.foundations)) {
          state.gameWon = true;
        }
        return state;
      });
    }

    setDragSource(null);
    setSelectedLocation(null);
  }, [dragSource, gameState, startGameIfNeeded, saveToHistory]);

  const handleDragStart = useCallback((e: React.DragEvent, location: Location) => {
    setDragSource(location);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragSource(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  // Touch event handlers
  const getCardsFromLocation = useCallback((location: Location): Card[] => {
    if (location.zone === 'waste') {
      if (gameState.waste.length === 0) return [];
      return [gameState.waste[gameState.waste.length - 1]];
    }
    if (location.zone === 'tableau' && location.index !== undefined && location.cardIndex !== undefined) {
      const column = gameState.tableau[location.index];
      return column.slice(location.cardIndex);
    }
    return [];
  }, [gameState]);

  const findDropTarget = useCallback((x: number, y: number): Location | null => {
    const element = document.elementFromPoint(x, y);
    if (!element) return null;

    const dropZone = element.closest('[data-drop-zone]');
    if (!dropZone) return null;

    const zone = dropZone.getAttribute('data-drop-zone');

    if (zone === 'tableau') {
      const indexStr = dropZone.getAttribute('data-column-index');
      const index = indexStr ? parseInt(indexStr, 10) : NaN;
      if (!isNaN(index)) {
        return { zone: 'tableau', index };
      }
    }

    if (zone === 'foundation') {
      const indexStr = dropZone.getAttribute('data-foundation-index');
      const index = indexStr ? parseInt(indexStr, 10) : NaN;
      if (!isNaN(index)) {
        return { zone: 'foundation', index };
      }
    }

    return null;
  }, []);

  const isValidDropTarget = useCallback((cards: Card[], target: Location): boolean => {
    if (target.zone === 'tableau' && target.index !== undefined) {
      return canPlaceOnTableau(cards, gameState.tableau[target.index]);
    }
    if (target.zone === 'foundation' && target.index !== undefined && cards.length === 1) {
      return canPlaceOnFoundation(cards[0], gameState.foundations[target.index], target.index);
    }
    return false;
  }, [gameState]);

  const handleTouchStartWaste = useCallback((e: React.TouchEvent) => {
    if (gameState.waste.length === 0) return;

    const touch = e.touches[0];
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const cards = [gameState.waste[gameState.waste.length - 1]];

    setTouchDrag({
      sourceLocation: { zone: 'waste' },
      cards,
      startPosition: { x: touch.clientX, y: touch.clientY },
      currentPosition: { x: touch.clientX, y: touch.clientY },
      offset: { x: touch.clientX - rect.left, y: touch.clientY - rect.top },
      isDragging: false,
    });
  }, [gameState.waste]);

  const handleTouchStartTableau = useCallback((e: React.TouchEvent, columnIndex: number, cardIndex: number) => {
    const column = gameState.tableau[columnIndex];
    const card = column[cardIndex];
    if (!card.faceUp) return;

    const touch = e.touches[0];
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const cards = column.slice(cardIndex);

    setTouchDrag({
      sourceLocation: { zone: 'tableau', index: columnIndex, cardIndex },
      cards,
      startPosition: { x: touch.clientX, y: touch.clientY },
      currentPosition: { x: touch.clientX, y: touch.clientY },
      offset: { x: touch.clientX - rect.left, y: touch.clientY - rect.top },
      isDragging: false,
    });
  }, [gameState.tableau]);

  // Global touch move/end handlers
  useEffect(() => {
    if (!touchDrag) return;

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const dx = touch.clientX - touchDrag.startPosition.x;
      const dy = touch.clientY - touchDrag.startPosition.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const newDragState = {
        ...touchDrag,
        currentPosition: { x: touch.clientX, y: touch.clientY },
        isDragging: touchDrag.isDragging || distance >= DRAG_THRESHOLD,
      };
      setTouchDrag(newDragState);

      // Only prevent scroll and update highlight if we're dragging
      if (newDragState.isDragging) {
        e.preventDefault();
        const target = findDropTarget(touch.clientX, touch.clientY);
        if (target && isValidDropTarget(touchDrag.cards, target)) {
          setHighlightedDropTarget(target);
        } else {
          setHighlightedDropTarget(null);
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];

      if (touchDrag.isDragging) {
        // This was a drag - try to drop
        e.preventDefault();
        const target = findDropTarget(touch.clientX, touch.clientY);

        if (target && isValidDropTarget(touchDrag.cards, target)) {
          saveToHistory(gameState);
          setGameState(prev => {
            let state = startGameIfNeeded(prev);
            state = moveCards(state, touchDrag.sourceLocation, target);
            if (target.zone === 'foundation' && checkWin(state.foundations)) {
              state.gameWon = true;
            }
            return state;
          });
        }

        setSelectedLocation(null);
      }
      // If not dragging, let the click handler handle it

      setTouchDrag(null);
      setHighlightedDropTarget(null);
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [touchDrag, findDropTarget, isValidDropTarget, gameState, saveToHistory, startGameIfNeeded]);

  const getSelectedCards = useCallback((): Card[] | null => {
    if (!selectedLocation) return null;

    if (selectedLocation.zone === 'waste') {
      if (gameState.waste.length === 0) return null;
      return [gameState.waste[gameState.waste.length - 1]];
    }

    if (selectedLocation.zone === 'tableau' && selectedLocation.index !== undefined && selectedLocation.cardIndex !== undefined) {
      const column = gameState.tableau[selectedLocation.index];
      return column.slice(selectedLocation.cardIndex);
    }

    return null;
  }, [selectedLocation, gameState]);

  const getDraggedCards = useCallback((): Card[] | null => {
    if (!dragSource) return null;

    if (dragSource.zone === 'waste') {
      if (gameState.waste.length === 0) return null;
      return [gameState.waste[gameState.waste.length - 1]];
    }

    if (dragSource.zone === 'tableau' && dragSource.index !== undefined && dragSource.cardIndex !== undefined) {
      const column = gameState.tableau[dragSource.index];
      return column.slice(dragSource.cardIndex);
    }

    return null;
  }, [dragSource, gameState]);

  const moveCards = (state: GameState, from: Location, to: Location): GameState => {
    let newState = { ...state };
    let cardsToMove: Card[] = [];

    // Remove cards from source
    if (from.zone === 'waste') {
      cardsToMove = [state.waste[state.waste.length - 1]];
      newState.waste = state.waste.slice(0, -1);
    } else if (from.zone === 'tableau' && from.index !== undefined && from.cardIndex !== undefined) {
      const column = [...state.tableau[from.index]];
      cardsToMove = column.slice(from.cardIndex);
      const remaining = column.slice(0, from.cardIndex);
      // Flip the new top card if needed
      if (remaining.length > 0 && !remaining[remaining.length - 1].faceUp) {
        remaining[remaining.length - 1] = { ...remaining[remaining.length - 1], faceUp: true };
      }
      const newTableau = [...state.tableau] as GameState['tableau'];
      newTableau[from.index] = remaining;
      newState.tableau = newTableau;
    }

    // Add cards to destination
    if (to.zone === 'tableau' && to.index !== undefined) {
      const newTableau = [...newState.tableau] as GameState['tableau'];
      newTableau[to.index] = [...newTableau[to.index], ...cardsToMove.map(c => ({ ...c, faceUp: true }))];
      newState.tableau = newTableau;
    } else if (to.zone === 'foundation' && to.index !== undefined) {
      const newFoundations = [...newState.foundations] as GameState['foundations'];
      newFoundations[to.index] = [...newFoundations[to.index], { ...cardsToMove[0], faceUp: true }];
      newState.foundations = newFoundations;
    }

    newState.moveCount = state.moveCount + 1;
    return newState;
  };

  // Handle clicking on empty tableau column
  const handleEmptyTableauClick = useCallback((columnIndex: number) => {
    if (!selectedLocation) return;

    const cardsToMove = getSelectedCards();
    if (!cardsToMove) return;

    const column = gameState.tableau[columnIndex];
    if (canPlaceOnTableau(cardsToMove, column)) {
      saveToHistory(gameState);
      setGameState(prev => {
        const state = startGameIfNeeded(prev);
        return moveCards(state, selectedLocation, { zone: 'tableau', index: columnIndex });
      });
      setSelectedLocation(null);
    }
  }, [selectedLocation, getSelectedCards, gameState, startGameIfNeeded, saveToHistory]);

  // Handle clicking on foundation pile to move selected card there
  const handleFoundationClick = useCallback((foundationIndex: number) => {
    if (!selectedLocation) return;

    const cardsToMove = getSelectedCards();
    if (!cardsToMove || cardsToMove.length !== 1) return;

    const card = cardsToMove[0];
    if (canPlaceOnFoundation(card, gameState.foundations[foundationIndex], foundationIndex)) {
      saveToHistory(gameState);
      setGameState(prev => {
        let state = startGameIfNeeded(prev);
        state = moveCards(state, selectedLocation, { zone: 'foundation', index: foundationIndex });
        if (checkWin(state.foundations)) {
          state.gameWon = true;
        }
        return state;
      });
      setSelectedLocation(null);
    }
  }, [selectedLocation, getSelectedCards, gameState, startGameIfNeeded, saveToHistory]);

  // Compute hint highlight locations from hintMove
  const hintHighlight = (() => {
    if (!hintMove) return null;

    const result: {
      stockSource?: boolean;
      wasteSource?: boolean;
      foundationTarget?: number;
      tableauSourceColumn?: number;
      tableauSourceCardIndex?: number;
      tableauTargetColumn?: number;
    } = {};

    // Determine source
    if (hintMove.type === 'pool-to-foundation' || hintMove.type === 'pool-to-tableau') {
      // Check if the hint card is at the top of the waste pile
      const hintCardId = hintMove.from?.cardId;
      const topWasteCard = gameState.waste.length > 0 ? gameState.waste[gameState.waste.length - 1] : null;

      if (topWasteCard && topWasteCard.id === hintCardId) {
        // Card is at top of waste, highlight waste
        result.wasteSource = true;
      } else {
        // Card is not at top of waste, highlight stock to indicate user needs to cycle
        result.stockSource = true;
      }
    } else if (hintMove.type === 'tableau-to-foundation' || hintMove.type === 'tableau-to-tableau') {
      if (hintMove.from?.zone === 'tableau' && hintMove.from.index !== undefined) {
        result.tableauSourceColumn = hintMove.from.index;
        result.tableauSourceCardIndex = hintMove.from.cardIndex;
      }
    }

    // Determine target
    if (hintMove.type === 'pool-to-foundation' || hintMove.type === 'tableau-to-foundation') {
      if (hintMove.to?.zone === 'foundation' && hintMove.to.index !== undefined) {
        result.foundationTarget = hintMove.to.index;
      }
    } else if (hintMove.type === 'pool-to-tableau' || hintMove.type === 'tableau-to-tableau') {
      if (hintMove.to?.zone === 'tableau' && hintMove.to.index !== undefined) {
        result.tableauTargetColumn = hintMove.to.index;
      }
    }

    return result;
  })();

  return (
    <div className="solitaire-game">
      <GameControls
        onNewGame={handleNewGameRequest}
        onUndo={handleUndo}
        onHint={handleHint}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onAutosolve={handleAutosolve}
        canUndo={history.length > 0}
        hintAvailable={!gameState.gameWon && !isAutosolving && generateAllMoves(gameState).length > 0}
        autosolveAvailable={!gameState.gameWon && !isAutosolving && areAllCardsFaceUp(gameState)}
        moveCount={gameState.moveCount}
        elapsedTime={elapsedTime}
        solvabilityResult={solvabilityResult}
        translations={t}
      />

      <div className="solitaire-board" ref={boardRef}>
        <div className="top-row">
          <div className="stock-waste-area">
            <Stock cards={gameState.stock} onClick={handleStockClick} hintHighlight={hintHighlight?.stockSource} />
            <Waste
              cards={gameState.waste}
              onCardClick={handleWasteClick}
              onDragStart={(e) => handleDragStart(e, { zone: 'waste' })}
              onDragEnd={handleDragEnd}
              onTouchStart={handleTouchStartWaste}
              selectedCard={selectedLocation?.zone === 'waste'}
              isTouchDragging={touchDrag?.isDragging && touchDrag?.sourceLocation.zone === 'waste'}
              hintHighlight={hintHighlight?.wasteSource ? 'source' : undefined}
            />
          </div>

          <Foundation
            piles={gameState.foundations}
            onDrop={handleFoundationDrop}
            onDragOver={handleDragOver}
            onClick={handleFoundationClick}
            highlightIndex={highlightedDropTarget?.zone === 'foundation' ? highlightedDropTarget.index : undefined}
            hintTargetIndex={hintHighlight?.foundationTarget}
          />
        </div>

        <Tableau
          columns={gameState.tableau}
          onCardClick={handleTableauCardClick}
          onEmptyClick={handleEmptyTableauClick}
          onDragStart={(e, columnIndex, cardIndex) =>
            handleDragStart(e, { zone: 'tableau', index: columnIndex, cardIndex })
          }
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDrop={handleTableauDrop}
          onTouchStart={handleTouchStartTableau}
          selectedColumn={selectedLocation?.zone === 'tableau' ? selectedLocation.index : undefined}
          selectedCardIndex={selectedLocation?.zone === 'tableau' ? selectedLocation.cardIndex : undefined}
          highlightColumn={highlightedDropTarget?.zone === 'tableau' ? highlightedDropTarget.index : undefined}
          touchDraggingColumn={touchDrag?.isDragging && touchDrag?.sourceLocation.zone === 'tableau' ? touchDrag.sourceLocation.index : undefined}
          touchDraggingCardIndex={touchDrag?.isDragging && touchDrag?.sourceLocation.zone === 'tableau' ? touchDrag.sourceLocation.cardIndex : undefined}
          hintSourceColumn={hintHighlight?.tableauSourceColumn}
          hintSourceCardIndex={hintHighlight?.tableauSourceCardIndex}
          hintTargetColumn={hintHighlight?.tableauTargetColumn}
        />
      </div>

      {touchDrag?.isDragging && (
        <DragPreview
          cards={touchDrag.cards}
          position={touchDrag.currentPosition}
          offset={touchDrag.offset}
        />
      )}

      {isAutosolving && (
        <AutosolveAnimation
          initialState={gameState}
          onComplete={handleAutosolveComplete}
          onStateUpdate={handleAutosolveStateUpdate}
        />
      )}

      {showWinAnimation && (
        <WinAnimation
          foundations={gameState.foundations}
          onComplete={handleWinAnimationComplete}
        />
      )}

      {showWinDialog && (
        <WinDialog
          moveCount={gameState.moveCount}
          elapsedTime={elapsedTime}
          onPlayAgain={handleNewGameConfirm}
          translations={t}
        />
      )}

      {showNewGameConfirm && (
        <div className="win-overlay">
          <div className="win-dialog window">
            <div className="title-bar">
              <span>{t.confirmNewGame}</span>
            </div>
            <div className="win-content">
              <p className="confirm-message">{t.confirmNewGameMessage}</p>
              <div className="confirm-buttons">
                <button className="retro-btn" onClick={handleNewGameConfirm}>
                  {t.confirm}
                </button>
                <button className="retro-btn" onClick={handleNewGameCancel}>
                  {t.cancel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
