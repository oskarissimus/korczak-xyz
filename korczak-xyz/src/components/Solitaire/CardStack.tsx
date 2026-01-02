import React from 'react';
import { Card, CardPlaceholder } from './Card';
import type { Card as CardType } from '../../utils/solitaire/types';

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
}

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
}: CardStackProps) {
  if (cards.length === 0) {
    return (
      <CardPlaceholder
        onDragOver={onDragOver}
        onDrop={onDrop}
        suit={placeholderSuit}
        highlight={highlight}
      />
    );
  }

  const getOffset = (index: number, card: CardType) => {
    if (spread === 'none') return 0;

    // Use smaller spread for face-down cards
    const offset = card.faceUp ? spreadAmount : faceDownSpread;

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
          ? `calc(100px + ${cards.reduce((acc, card, i) => acc + (card.faceUp ? spreadAmount : faceDownSpread), 0) - (cards[0]?.faceUp ? spreadAmount : faceDownSpread)}px)`
          : '100px',
        width: spread === 'horizontal'
          ? `calc(70px + ${(cards.length - 1) * spreadAmount}px)`
          : '70px',
      }}
    >
      {cards.map((card, index) => {
        const offset = cards.slice(0, index).reduce(
          (acc, c) => acc + (c.faceUp ? spreadAmount : faceDownSpread),
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
            style={style}
          />
        );
      })}
    </div>
  );
}
