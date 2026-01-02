import React from 'react';
import type { Card as CardType } from '../../utils/solitaire/types';
import { SUIT_SYMBOLS, SUIT_COLORS } from '../../utils/solitaire/types';

interface DragPreviewProps {
  cards: CardType[];
  position: { x: number; y: number };
  offset: { x: number; y: number };
}

export function DragPreview({ cards, position, offset }: DragPreviewProps) {
  if (cards.length === 0) return null;

  return (
    <div
      className="drag-preview"
      style={{
        left: position.x - offset.x,
        top: position.y - offset.y,
      }}
    >
      {cards.map((card, index) => {
        const suitSymbol = SUIT_SYMBOLS[card.suit];
        const suitColor = SUIT_COLORS[card.suit];

        return (
          <div
            key={card.id}
            className={`solitaire-card face-up ${suitColor}`}
            style={{
              position: index === 0 ? 'relative' : 'absolute',
              top: index === 0 ? 0 : index * 25,
              left: 0,
            }}
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
      })}
    </div>
  );
}
