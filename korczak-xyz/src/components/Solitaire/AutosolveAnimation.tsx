import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { GameState, Card } from '../../utils/solitaire/types';
import { SUIT_SYMBOLS, SUIT_COLORS, getRankValue } from '../../utils/solitaire/types';
import { canPlaceOnFoundation, getFoundationIndexForSuit } from '../../utils/solitaire/rules';

interface AutosolveAnimationProps {
  initialState: GameState;
  onComplete: (finalState: GameState) => void;
  onStateUpdate: (state: GameState) => void;
}

interface FlyingCard {
  card: Card;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  progress: number; // 0 to 1
  isFlipping?: boolean; // For stock draw animation
}

type AutosolveMove =
  | { type: 'tableau-to-foundation'; card: Card; columnIndex: number; cardIndex: number; foundationIndex: number }
  | { type: 'waste-to-foundation'; card: Card; foundationIndex: number }
  | { type: 'draw-stock'; card: Card }
  | { type: 'reset-stock' };

const ANIMATION_DURATION = 200; // ms per card

export function AutosolveAnimation({ initialState, onComplete, onStateUpdate }: AutosolveAnimationProps) {
  // Use ref to store initial state so it doesn't change during animation
  const initialStateRef = useRef(initialState);
  const [gameState, setGameState] = useState<GameState>(() => initialStateRef.current);
  const [flyingCard, setFlyingCard] = useState<FlyingCard | null>(null);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const isProcessingRef = useRef(false);

  // Track stock cycles to prevent infinite loops
  const stockCycleCountRef = useRef(0);
  const lastFoundationMoveCountRef = useRef(initialState.moveCount);

  // Sync state updates to parent - use effect to avoid updating during render
  const prevGameStateRef = useRef(gameState);
  useEffect(() => {
    if (prevGameStateRef.current !== gameState) {
      prevGameStateRef.current = gameState;
      onStateUpdate(gameState);
    }
  }, [gameState, onStateUpdate]);

  // Find the next move to make
  const findNextMove = useCallback((state: GameState): AutosolveMove | null => {
    // 1. Check if top waste card can go to any foundation
    if (state.waste.length > 0) {
      const wasteCard = state.waste[state.waste.length - 1];
      const foundationIndex = getFoundationIndexForSuit(wasteCard.suit);
      if (canPlaceOnFoundation(wasteCard, state.foundations[foundationIndex], foundationIndex)) {
        return { type: 'waste-to-foundation', card: wasteCard, foundationIndex };
      }
    }

    // 2. Check tableau cards - find lowest rank cards first (Aces, then 2s, etc.)
    for (let rank = 1; rank <= 13; rank++) {
      for (let colIdx = 0; colIdx < 7; colIdx++) {
        const column = state.tableau[colIdx];
        if (column.length === 0) continue;

        // Only check the top card of each column
        const cardIdx = column.length - 1;
        const card = column[cardIdx];
        if (!card.faceUp) continue;

        if (getRankValue(card.rank) === rank) {
          const foundationIndex = getFoundationIndexForSuit(card.suit);
          if (canPlaceOnFoundation(card, state.foundations[foundationIndex], foundationIndex)) {
            return { type: 'tableau-to-foundation', card, columnIndex: colIdx, cardIndex: cardIdx, foundationIndex };
          }
        }
      }
    }

    // 3. If stock has cards, draw from stock
    if (state.stock.length > 0) {
      const card = state.stock[state.stock.length - 1];
      return { type: 'draw-stock', card };
    }

    // 4. If stock empty but waste has cards, reset stock from waste
    if (state.waste.length > 0) {
      return { type: 'reset-stock' };
    }

    // 5. No more moves - done
    return null;
  }, []);

  // Get element position for animation coordinates
  const getElementPosition = useCallback((selector: string): { x: number; y: number } | null => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  }, []);

  // Execute tableau to foundation move
  const executeTableauToFoundation = useCallback((move: Extract<AutosolveMove, { type: 'tableau-to-foundation' }>) => {
    setGameState(prev => {
      const newTableau = [...prev.tableau] as GameState['tableau'];
      const column = [...newTableau[move.columnIndex]];
      column.pop();
      newTableau[move.columnIndex] = column;

      const newFoundations = [...prev.foundations] as GameState['foundations'];
      newFoundations[move.foundationIndex] = [...newFoundations[move.foundationIndex], { ...move.card, faceUp: true }];

      // Track foundation move for cycle detection
      lastFoundationMoveCountRef.current = prev.moveCount + 1;
      stockCycleCountRef.current = 0;

      return {
        ...prev,
        tableau: newTableau,
        foundations: newFoundations,
        moveCount: prev.moveCount + 1,
      };
    });

    setFlyingCard(null);
    isProcessingRef.current = false;
  }, []);

  // Execute waste to foundation move
  const executeWasteToFoundation = useCallback((move: Extract<AutosolveMove, { type: 'waste-to-foundation' }>) => {
    setGameState(prev => {
      const newWaste = prev.waste.slice(0, -1);

      const newFoundations = [...prev.foundations] as GameState['foundations'];
      newFoundations[move.foundationIndex] = [...newFoundations[move.foundationIndex], { ...move.card, faceUp: true }];

      // Track foundation move for cycle detection
      lastFoundationMoveCountRef.current = prev.moveCount + 1;
      stockCycleCountRef.current = 0;

      return {
        ...prev,
        waste: newWaste,
        foundations: newFoundations,
        moveCount: prev.moveCount + 1,
      };
    });

    setFlyingCard(null);
    isProcessingRef.current = false;
  }, []);

  // Execute draw from stock
  const executeDrawStock = useCallback((move: Extract<AutosolveMove, { type: 'draw-stock' }>) => {
    setGameState(prev => {
      const newStock = prev.stock.slice(0, -1);
      const newWaste = [...prev.waste, { ...move.card, faceUp: true }];

      return {
        ...prev,
        stock: newStock,
        waste: newWaste,
      };
    });

    setFlyingCard(null);
    isProcessingRef.current = false;
  }, []);

  // Execute reset stock from waste
  const executeResetStock = useCallback(() => {
    setGameState(prev => {
      // Increment cycle count
      stockCycleCountRef.current += 1;

      // Check if we've cycled without making progress - game is stuck
      if (stockCycleCountRef.current > 1) {
        // We've gone through the entire stock twice without a foundation move
        // This means no more moves are possible
        setTimeout(() => onComplete(prev), 50);
        return prev;
      }

      const newStock = [...prev.waste].reverse().map(c => ({ ...c, faceUp: false }));

      return {
        ...prev,
        stock: newStock,
        waste: [],
      };
    });

    setFlyingCard(null);
    isProcessingRef.current = false;
  }, [onComplete]);

  // Process next move
  const processNextMove = useCallback(() => {
    if (isProcessingRef.current) return;

    const move = findNextMove(gameState);
    if (!move) {
      // No more moves - all cards in foundations
      onComplete(gameState);
      return;
    }

    isProcessingRef.current = true;

    // Handle different move types
    if (move.type === 'tableau-to-foundation') {
      const fromPos = getElementPosition(`[data-column-index="${move.columnIndex}"] .solitaire-card:last-child`);
      const toPos = getElementPosition(`[data-foundation-index="${move.foundationIndex}"]`);

      if (!fromPos || !toPos) {
        executeTableauToFoundation(move);
        return;
      }

      setFlyingCard({
        card: move.card,
        fromX: fromPos.x,
        fromY: fromPos.y,
        toX: toPos.x,
        toY: toPos.y,
        progress: 0,
      });

      startTimeRef.current = performance.now();
      const animateMove = move;

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTimeRef.current;
        const progress = Math.min(elapsed / ANIMATION_DURATION, 1);

        setFlyingCard(prev => prev ? { ...prev, progress } : null);

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          executeTableauToFoundation(animateMove);
        }
      };

      animationRef.current = requestAnimationFrame(animate);
    } else if (move.type === 'waste-to-foundation') {
      const fromPos = getElementPosition('.waste-pile .solitaire-card:last-child');
      const toPos = getElementPosition(`[data-foundation-index="${move.foundationIndex}"]`);

      if (!fromPos || !toPos) {
        executeWasteToFoundation(move);
        return;
      }

      setFlyingCard({
        card: move.card,
        fromX: fromPos.x,
        fromY: fromPos.y,
        toX: toPos.x,
        toY: toPos.y,
        progress: 0,
      });

      startTimeRef.current = performance.now();
      const animateMove = move;

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTimeRef.current;
        const progress = Math.min(elapsed / ANIMATION_DURATION, 1);

        setFlyingCard(prev => prev ? { ...prev, progress } : null);

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          executeWasteToFoundation(animateMove);
        }
      };

      animationRef.current = requestAnimationFrame(animate);
    } else if (move.type === 'draw-stock') {
      const fromPos = getElementPosition('.stock-pile');
      const toPos = getElementPosition('.waste-pile');

      if (!fromPos || !toPos) {
        executeDrawStock(move);
        return;
      }

      setFlyingCard({
        card: move.card,
        fromX: fromPos.x,
        fromY: fromPos.y,
        toX: toPos.x,
        toY: toPos.y,
        progress: 0,
        isFlipping: true,
      });

      startTimeRef.current = performance.now();
      const animateMove = move;

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTimeRef.current;
        const progress = Math.min(elapsed / ANIMATION_DURATION, 1);

        setFlyingCard(prev => prev ? { ...prev, progress } : null);

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          executeDrawStock(animateMove);
        }
      };

      animationRef.current = requestAnimationFrame(animate);
    } else if (move.type === 'reset-stock') {
      // For reset, just execute immediately with a brief delay
      setTimeout(() => {
        executeResetStock();
      }, 100);
    }
  }, [gameState, findNextMove, getElementPosition, onComplete, executeTableauToFoundation, executeWasteToFoundation, executeDrawStock, executeResetStock]);

  // Start processing moves
  useEffect(() => {
    if (!flyingCard && !isProcessingRef.current) {
      const timer = setTimeout(() => {
        processNextMove();
      }, 50); // Small delay between moves
      return () => clearTimeout(timer);
    }
  }, [gameState, flyingCard, processNextMove]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  if (!flyingCard) return null;

  // Easing function for smooth animation
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
  const easedProgress = easeOutCubic(flyingCard.progress);

  const currentX = flyingCard.fromX + (flyingCard.toX - flyingCard.fromX) * easedProgress;
  const currentY = flyingCard.fromY + (flyingCard.toY - flyingCard.fromY) * easedProgress;

  // For stock draw, show card back at start, face at end
  const showFace = flyingCard.isFlipping ? flyingCard.progress > 0.5 : true;

  if (!showFace) {
    // Show card back during first half of flip animation
    return (
      <div
        className="solitaire-card face-down flying-card"
        style={{
          position: 'fixed',
          left: currentX,
          top: currentY,
          zIndex: 1000,
          pointerEvents: 'none',
          transition: 'none',
          transform: `rotateY(${flyingCard.progress * 180}deg)`,
        }}
      >
        <div className="card-back"></div>
      </div>
    );
  }

  const suitSymbol = SUIT_SYMBOLS[flyingCard.card.suit];
  const suitColor = SUIT_COLORS[flyingCard.card.suit];

  return (
    <div
      className={`solitaire-card face-up ${suitColor} flying-card`}
      style={{
        position: 'fixed',
        left: currentX,
        top: currentY,
        zIndex: 1000,
        pointerEvents: 'none',
        transition: 'none',
        transform: flyingCard.isFlipping ? `rotateY(${180 - (flyingCard.progress - 0.5) * 2 * 180}deg)` : undefined,
      }}
    >
      <div className="card-corner top-left">
        <span className="card-rank">{flyingCard.card.rank}</span>
        <span className="card-suit">{suitSymbol}</span>
      </div>
      <div className="card-center">
        <span className="card-suit-large">{suitSymbol}</span>
      </div>
      <div className="card-corner bottom-right">
        <span className="card-rank">{flyingCard.card.rank}</span>
        <span className="card-suit">{suitSymbol}</span>
      </div>
    </div>
  );
}
