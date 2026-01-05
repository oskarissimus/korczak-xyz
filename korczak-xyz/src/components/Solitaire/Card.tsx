import React from 'react';
import type { Card as CardType } from '../../utils/solitaire/types';
import { SUIT_SYMBOLS, SUIT_COLORS } from '../../utils/solitaire/types';

interface CardProps {
  card: CardType;
  onClick?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  selected?: boolean;
  draggable?: boolean;
  isTouchDragging?: boolean;
  hintHighlight?: 'source' | 'target';
  style?: React.CSSProperties;
}

export function Card({
  card,
  onClick,
  onDragStart,
  onDragEnd,
  onTouchStart,
  selected = false,
  draggable = false,
  isTouchDragging = false,
  hintHighlight,
  style,
}: CardProps) {
  const suitSymbol = SUIT_SYMBOLS[card.suit];
  const suitColor = SUIT_COLORS[card.suit];

  if (!card.faceUp) {
    return (
      <div
        className="solitaire-card face-down"
        style={style}
        onClick={onClick}
      >
        <div className="card-back-pattern" />
      </div>
    );
  }

  const hintClass = hintHighlight ? `hint-${hintHighlight}` : '';

  return (
    <div
      className={`solitaire-card face-up ${suitColor} ${selected ? 'selected' : ''} ${isTouchDragging ? 'touch-dragging' : ''} ${hintClass}`}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onTouchStart={onTouchStart}
      style={style}
    >
      <div className="card-corner top-left">
        <span className="card-rank">{card.rank}</span>
        <span className="card-suit">{suitSymbol}</span>
      </div>
      <div className="card-center">
        <span className="card-suit-large">{suitSymbol}</span>
      </div>
      <div className="card-corner bottom-right">
        <span className="card-rank">{card.rank}</span>
        <span className="card-suit">{suitSymbol}</span>
      </div>
    </div>
  );
}

interface CardPlaceholderProps {
  onClick?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  suit?: string;
  highlight?: boolean;
  hintHighlight?: 'source' | 'target';
}

export function CardPlaceholder({
  onClick,
  onDragOver,
  onDrop,
  suit,
  highlight = false,
  hintHighlight,
}: CardPlaceholderProps) {
  const hintClass = hintHighlight ? `hint-${hintHighlight}` : '';

  return (
    <div
      className={`card-placeholder ${highlight ? 'highlight' : ''} ${hintClass}`}
      onClick={onClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-suit={suit}
    >
      {suit && <span className="placeholder-suit">{suit}</span>}
    </div>
  );
}
