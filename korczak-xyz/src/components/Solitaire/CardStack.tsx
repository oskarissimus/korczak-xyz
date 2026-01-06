import React, { useSyncExternalStore } from 'react';
import { Card, CardPlaceholder } from './Card';
import type { Card as CardType } from '../../utils/solitaire/types';

// Mobile detection for responsive spread amounts
const MOBILE_BREAKPOINT = 580;

function subscribeToResize(callback: () => void) {
  window.addEventListener('resize', callback);
  return () => window.removeEventListener('resize', callback);
}

function getIsMobile() {
  return typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT;
}

function useIsMobile() {
  return useSyncExternalStore(subscribeToResize, getIsMobile, () => false);
}

interface CardStackProps {
  cards: CardType[];
  spread?: 'vertical' | 'horizontal' | 'none';
  spreadAmount?: number;
  faceDownSpread?: number;
  onCardClick?: (cardIndex: number) => void;
  onDragStart?: (e: React.DragEvent, cardIndex: number) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onTouchStart?: (e: React.TouchEvent, cardIndex: number) => void;
  selectedCardIndex?: number;
  draggableFromIndex?: number;
  placeholderSuit?: string;
  highlight?: boolean;
  touchDraggingIndex?: number;
  hintSourceIndex?: number;
  hintTarget?: boolean;
}

// Mobile spread value for face-up cards (smaller for tighter stacking)
const MOBILE_SPREAD_FACEUP = 18;

export function CardStack({
  cards,
  spread = 'none',
  spreadAmount = 25,
  faceDownSpread = 10,
  onCardClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onTouchStart,
  selectedCardIndex,
  draggableFromIndex,
  placeholderSuit,
  highlight = false,
  touchDraggingIndex,
  hintSourceIndex,
  hintTarget,
}: CardStackProps) {
  const isMobile = useIsMobile();

  // Use smaller spread for face-up cards on mobile for tighter stacking
  const effectiveSpreadAmount = isMobile ? MOBILE_SPREAD_FACEUP : spreadAmount;

  if (cards.length === 0) {
    return (
      <CardPlaceholder
        onDragOver={onDragOver}
        onDrop={onDrop}
        suit={placeholderSuit}
        highlight={highlight}
        hintHighlight={hintTarget ? 'target' : undefined}
      />
    );
  }

  const getOffset = (index: number, card: CardType) => {
    if (spread === 'none') return 0;

    // Use smaller spread for face-down cards
    const offset = card.faceUp ? effectiveSpreadAmount : faceDownSpread;

    if (spread === 'vertical') {
      return index * offset;
    }
    return index * offset;
  };

  return (
    <div
      className={`card-stack ${spread} ${highlight ? 'highlight' : ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        position: 'relative',
        height: spread === 'vertical'
          ? `calc(100px + ${cards.reduce((acc, card, i) => acc + (card.faceUp ? effectiveSpreadAmount : faceDownSpread), 0) - (cards[0]?.faceUp ? effectiveSpreadAmount : faceDownSpread)}px)`
          : '100px',
        width: spread === 'horizontal'
          ? `calc(70px + ${(cards.length - 1) * effectiveSpreadAmount}px)`
          : '70px',
      }}
    >
      {cards.map((card, index) => {
        const offset = cards.slice(0, index).reduce(
          (acc, c) => acc + (c.faceUp ? effectiveSpreadAmount : faceDownSpread),
          0
        );

        const style: React.CSSProperties = {
          position: 'absolute',
          top: spread === 'vertical' ? offset : 0,
          left: spread === 'horizontal' ? offset : 0,
          zIndex: index,
        };

        const isDraggable =
          card.faceUp &&
          draggableFromIndex !== undefined &&
          index >= draggableFromIndex;

        const isTouchDragging = touchDraggingIndex !== undefined && index >= touchDraggingIndex;

        // Determine hint highlight: source cards from hintSourceIndex, target is top card when hintTarget
        let hintHighlight: 'source' | 'target' | undefined;
        if (hintSourceIndex !== undefined && index >= hintSourceIndex) {
          hintHighlight = 'source';
        } else if (hintTarget && index === cards.length - 1) {
          hintHighlight = 'target';
        }

        return (
          <Card
            key={card.id}
            card={card}
            onClick={() => onCardClick?.(index)}
            onDragStart={(e) => onDragStart?.(e, index)}
            onDragEnd={onDragEnd}
            onTouchStart={isDraggable ? (e) => onTouchStart?.(e, index) : undefined}
            selected={selectedCardIndex !== undefined && index >= selectedCardIndex}
            draggable={isDraggable}
            isTouchDragging={isTouchDragging}
            hintHighlight={hintHighlight}
            style={style}
          />
        );
      })}
    </div>
  );
}
