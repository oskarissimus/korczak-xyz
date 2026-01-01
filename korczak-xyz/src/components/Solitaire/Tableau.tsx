import React from 'react';
import { CardStack } from './CardStack';
import type { Card as CardType } from '../../utils/solitaire/types';

interface TableauProps {
  columns: [CardType[], CardType[], CardType[], CardType[], CardType[], CardType[], CardType[]];
  onCardClick: (columnIndex: number, cardIndex: number) => void;
  onDragStart: (e: React.DragEvent, columnIndex: number, cardIndex: number) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (columnIndex: number) => void;
  selectedColumn?: number;
  selectedCardIndex?: number;
  highlightColumn?: number;
}

export function Tableau({
  columns,
  onCardClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  selectedColumn,
  selectedCardIndex,
  highlightColumn,
}: TableauProps) {
  return (
    <div className="tableau-area">
      {columns.map((column, columnIndex) => {
        // Find the first face-up card index for draggable calculation
        const firstFaceUpIndex = column.findIndex(card => card.faceUp);

        return (
          <div
            key={columnIndex}
            className={`tableau-column ${highlightColumn === columnIndex ? 'highlight' : ''}`}
            onDragOver={onDragOver}
            onDrop={(e) => {
              e.preventDefault();
              onDrop(columnIndex);
            }}
          >
            <CardStack
              cards={column}
              spread="vertical"
              spreadAmount={25}
              faceDownSpread={10}
              onCardClick={(cardIndex) => onCardClick(columnIndex, cardIndex)}
              onDragStart={(e, cardIndex) => onDragStart(e, columnIndex, cardIndex)}
              onDragEnd={onDragEnd}
              selectedCardIndex={selectedColumn === columnIndex ? selectedCardIndex : undefined}
              draggableFromIndex={firstFaceUpIndex >= 0 ? firstFaceUpIndex : undefined}
              highlight={highlightColumn === columnIndex}
            />
          </div>
        );
      })}
    </div>
  );
}
