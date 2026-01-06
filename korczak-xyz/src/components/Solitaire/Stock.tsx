import React from 'react';
import { Card, CardPlaceholder } from './Card';
import type { Card as CardType } from '../../utils/solitaire/types';

interface StockProps {
  cards: CardType[];
  onClick: () => void;
  hintHighlight?: boolean;
}

export function Stock({ cards, onClick, hintHighlight }: StockProps) {
  if (cards.length === 0) {
    return (
      <div className={`stock-pile${hintHighlight ? ' hint-source' : ''}`} onClick={onClick}>
        <CardPlaceholder />
        <div className="stock-refresh">↺</div>
      </div>
    );
  }

  // Show the top card of the stock (face down)
  const topCard = cards[cards.length - 1];

  return (
    <div className={`stock-pile${hintHighlight ? ' hint-source' : ''}`} onClick={onClick}>
      <Card card={{ ...topCard, faceUp: false }} />
      {cards.length > 1 && <div className="stock-count">{cards.length}</div>}
    </div>
  );
}
