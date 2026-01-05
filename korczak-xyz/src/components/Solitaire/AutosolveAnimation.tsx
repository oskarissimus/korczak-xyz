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
}

const ANIMATION_DURATION = 200; // ms per card

export function AutosolveAnimation({ initialState, onComplete, onStateUpdate }: AutosolveAnimationProps) {
  // Use ref to store initial state so it doesn't change during animation
  const initialStateRef = useRef(initialState);
  const [gameState, setGameState] = useState<GameState>(() => initialStateRef.current);
  const [flyingCard, setFlyingCard] = useState<FlyingCard | null>(null);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const isProcessingRef = useRef(false);

  // Find the next card that can be moved to foundation
  const findNextMove = useCallback((state: GameState): { card: Card; columnIndex: number; cardIndex: number; foundationIndex: number } | null => {
    // Priority: find lowest rank cards first (Aces, then 2s, etc.)
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
            return { card, columnIndex: colIdx, cardIndex: cardIdx, foundationIndex };
          }
        }
      }
    }
    return null;
  }, []);

  // Get element position for animation coordinates
  const getElementPosition = useCallback((selector: string): { x: number; y: number } | null => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  }, []);

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

    // Get positions for animation
    const fromPos = getElementPosition(`[data-column-index="${move.columnIndex}"] .solitaire-card:last-child`);
    const toPos = getElementPosition(`[data-foundation-index="${move.foundationIndex}"]`);

    if (!fromPos || !toPos) {
      // Fallback: skip animation for this card
      moveCardImmediately(move);
      return;
    }

    // Start flying animation
    setFlyingCard({
      card: move.card,
      fromX: fromPos.x,
      fromY: fromPos.y,
      toX: toPos.x,
      toY: toPos.y,
      progress: 0,
    });

    startTimeRef.current = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / ANIMATION_DURATION, 1);

      setFlyingCard(prev => prev ? { ...prev, progress } : null);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        // Animation complete - update game state
        moveCardImmediately(move);
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [gameState, findNextMove, getElementPosition, onComplete]);

  // Move card without animation (or after animation completes)
  const moveCardImmediately = useCallback((move: { card: Card; columnIndex: number; cardIndex: number; foundationIndex: number }) => {
    setGameState(prev => {
      const newTableau = [...prev.tableau] as GameState['tableau'];
      const column = [...newTableau[move.columnIndex]];
      column.pop(); // Remove top card
      newTableau[move.columnIndex] = column;

      const newFoundations = [...prev.foundations] as GameState['foundations'];
      newFoundations[move.foundationIndex] = [...newFoundations[move.foundationIndex], { ...move.card, faceUp: true }];

      const newState: GameState = {
        ...prev,
        tableau: newTableau,
        foundations: newFoundations,
        moveCount: prev.moveCount + 1,
      };

      onStateUpdate(newState);
      return newState;
    });

    setFlyingCard(null);
    isProcessingRef.current = false;
  }, [onStateUpdate]);

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
