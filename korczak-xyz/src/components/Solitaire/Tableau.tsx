import React from 'react';
import { CardStack } from './CardStack';
import type { Card as CardType } from '../../utils/solitaire/types';

interface TableauProps {
  columns: [CardType[], CardType[], CardType[], CardType[], CardType[], CardType[], CardType[]];
  onCardClick: (columnIndex: number, cardIndex: number) => void;
  onEmptyClick?: (columnIndex: number) => void;
  onDragStart: (e: React.DragEvent, columnIndex: number, cardIndex: number) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (columnIndex: number) => void;
  onTouchStart?: (e: React.TouchEvent, columnIndex: number, cardIndex: number) => void;
  selectedColumn?: number;
  selectedCardIndex?: number;
  highlightColumn?: number;
  touchDraggingColumn?: number;
  touchDraggingCardIndex?: number;
  hintSourceColumn?: number;
  hintSourceCardIndex?: number;
  hintTargetColumn?: number;
}

export function Tableau({
  columns,
  onCardClick,
  onEmptyClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onTouchStart,
  selectedColumn,
  selectedCardIndex,
  highlightColumn,
  touchDraggingColumn,
  touchDraggingCardIndex,
  hintSourceColumn,
  hintSourceCardIndex,
  hintTargetColumn,
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
            data-drop-zone="tableau"
            data-column-index={columnIndex}
            onDragOver={onDragOver}
            onDrop={(e) => {
              e.preventDefault();
              onDrop(columnIndex);
            }}
            onClick={() => column.length === 0 && onEmptyClick?.(columnIndex)}
          >
            <CardStack
              cards={column}
              spread="vertical"
              spreadAmount={25}
              faceDownSpread={10}
              onCardClick={(cardIndex) => onCardClick(columnIndex, cardIndex)}
              onDragStart={(e, cardIndex) => onDragStart(e, columnIndex, cardIndex)}
              onDragEnd={onDragEnd}
              onTouchStart={(e, cardIndex) => onTouchStart?.(e, columnIndex, cardIndex)}
              selectedCardIndex={selectedColumn === columnIndex ? selectedCardIndex : undefined}
              draggableFromIndex={firstFaceUpIndex >= 0 ? firstFaceUpIndex : undefined}
              highlight={highlightColumn === columnIndex}
              touchDraggingIndex={touchDraggingColumn === columnIndex ? touchDraggingCardIndex : undefined}
              hintSourceIndex={hintSourceColumn === columnIndex ? hintSourceCardIndex : undefined}
              hintTarget={hintTargetColumn === columnIndex}
            />
          </div>
        );
      })}
    </div>
  );
}
