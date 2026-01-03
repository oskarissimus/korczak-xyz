import React from 'react';
import { Card, CardPlaceholder } from './Card';
import type { Card as CardType } from '../../utils/solitaire/types';
import { SUIT_SYMBOLS } from '../../utils/solitaire/types';

interface FoundationProps {
  piles: [CardType[], CardType[], CardType[], CardType[]];
  onDrop: (foundationIndex: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onClick?: (foundationIndex: number) => void;
  highlightIndex?: number;
}

const FOUNDATION_SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;

export function Foundation({ piles, onDrop, onDragOver, onClick, highlightIndex }: FoundationProps) {
  return (
    <div className="foundation-area">
      {piles.map((pile, index) => {
        const suitSymbol = SUIT_SYMBOLS[FOUNDATION_SUITS[index]];
        const topCard = pile[pile.length - 1];

        return (
          <div
            key={index}
            className={`foundation-pile ${highlightIndex === index ? 'highlight' : ''}`}
            data-drop-zone="foundation"
            data-foundation-index={index}
            onDragOver={onDragOver}
            onDrop={(e) => {
              e.preventDefault();
              onDrop(index);
            }}
            onClick={() => onClick?.(index)}
          >
            {topCard ? (
              <Card card={{ ...topCard, faceUp: true }} />
            ) : (
              <CardPlaceholder
                suit={suitSymbol}
                highlight={highlightIndex === index}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
