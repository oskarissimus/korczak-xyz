import React from 'react';
import { Card, CardPlaceholder } from './Card';
import type { Card as CardType } from '../../utils/solitaire/types';

interface WasteProps {
  cards: CardType[];
  onCardClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  selectedCard: boolean;
  isTouchDragging?: boolean;
}

export function Waste({
  cards,
  onCardClick,
  onDragStart,
  onDragEnd,
  onTouchStart,
  selectedCard,
  isTouchDragging,
}: WasteProps) {
  if (cards.length === 0) {
    return (
      <div className="waste-pile">
        <CardPlaceholder />
      </div>
    );
  }

  // Show only the top card (or up to 3 in draw-3 mode, but we'll keep it simple)
  const topCard = cards[cards.length - 1];

  return (
    <div className="waste-pile">
      <Card
        card={{ ...topCard, faceUp: true }}
        onClick={onCardClick}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onTouchStart={onTouchStart}
        selected={selectedCard}
        draggable={true}
        isTouchDragging={isTouchDragging}
      />
    </div>
  );
}
