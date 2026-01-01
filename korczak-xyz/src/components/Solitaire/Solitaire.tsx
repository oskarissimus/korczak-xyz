import React, { useState, useEffect, useCallback } from 'react';
import { GameControls } from './GameControls';
import { Stock } from './Stock';
import { Waste } from './Waste';
import { Foundation } from './Foundation';
import { Tableau } from './Tableau';
import { WinDialog } from './WinDialog';
import { WinAnimation } from './WinAnimation';
import { dealCards } from '../../utils/solitaire/deck';
import { canPlaceOnFoundation, canPlaceOnTableau, checkWin, getFoundationIndexForSuit } from '../../utils/solitaire/rules';
import type { GameState, Card, Location, Move } from '../../utils/solitaire/types';

interface SolitaireProps {
  lang: 'en' | 'pl';
}

const translations = {
  en: {
    newGame: 'New Game',
    undo: 'Undo',
    moves: 'Moves',
    time: 'Time',
    youWin: 'You Win!',
    playAgain: 'Play Again',
  },
  pl: {
    newGame: 'Nowa Gra',
    undo: 'Cofnij',
    moves: 'Ruchy',
    time: 'Czas',
    youWin: 'Wygrales!',
    playAgain: 'Zagraj Ponownie',
  },
};

export default function Solitaire({ lang }: SolitaireProps) {
  const t = translations[lang];

  const [gameState, setGameState] = useState<GameState>(() => dealCards());
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [dragSource, setDragSource] = useState<Location | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [history, setHistory] = useState<GameState[]>([]);
  const [showWinAnimation, setShowWinAnimation] = useState(false);
  const [showWinDialog, setShowWinDialog] = useState(false);

  // Timer effect
  useEffect(() => {
    if (gameState.startTime && !gameState.gameWon) {
      const interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - gameState.startTime!) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [gameState.startTime, gameState.gameWon]);

  // Trigger win animation when game is won
  useEffect(() => {
    if (gameState.gameWon && !showWinAnimation && !showWinDialog) {
      setShowWinAnimation(true);
    }
  }, [gameState.gameWon, showWinAnimation, showWinDialog]);

  const handleWinAnimationComplete = useCallback(() => {
    setShowWinAnimation(false);
    setShowWinDialog(true);
  }, []);

  const startGameIfNeeded = useCallback((state: GameState): GameState => {
    if (!state.startTime) {
      return { ...state, startTime: Date.now() };
    }
    return state;
  }, []);

  const saveToHistory = useCallback((state: GameState) => {
    setHistory(prev => [...prev, state]);
  }, []);

  const handleNewGame = useCallback(() => {
    setGameState(dealCards());
    setSelectedLocation(null);
    setElapsedTime(0);
    setHistory([]);
    setShowWinAnimation(false);
    setShowWinDialog(false);
  }, []);

  const handleUndo = useCallback(() => {
    if (history.length > 0) {
      const prevState = history[history.length - 1];
      setGameState(prevState);
      setHistory(prev => prev.slice(0, -1));
      setSelectedLocation(null);
    }
  }, [history]);

  const handleStockClick = useCallback(() => {
    setGameState(prev => {
      const state = startGameIfNeeded(prev);
      saveToHistory(prev);

      if (state.stock.length === 0) {
        // Reset stock from waste
        if (state.waste.length === 0) return state;
        return {
          ...state,
          stock: [...state.waste].reverse().map(c => ({ ...c, faceUp: false })),
          waste: [],
        };
      }

      // Draw one card from stock to waste
      const card = state.stock[state.stock.length - 1];
      return {
        ...state,
        stock: state.stock.slice(0, -1),
        waste: [...state.waste, { ...card, faceUp: true }],
      };
    });
    setSelectedLocation(null);
  }, [startGameIfNeeded, saveToHistory]);

  const tryMoveToFoundation = useCallback((card: Card, fromLocation: Location, state: GameState): GameState | null => {
    const foundationIndex = getFoundationIndexForSuit(card.suit);
    if (canPlaceOnFoundation(card, state.foundations[foundationIndex], foundationIndex)) {
      const newFoundations = [...state.foundations] as GameState['foundations'];
      newFoundations[foundationIndex] = [...newFoundations[foundationIndex], { ...card, faceUp: true }];

      let newState: GameState;

      if (fromLocation.zone === 'waste') {
        newState = {
          ...state,
          waste: state.waste.slice(0, -1),
          foundations: newFoundations,
          moveCount: state.moveCount + 1,
        };
      } else if (fromLocation.zone === 'tableau' && fromLocation.index !== undefined) {
        const newTableau = [...state.tableau] as GameState['tableau'];
        const column = [...newTableau[fromLocation.index]];
        column.pop();
        // Flip the new top card if needed
        if (column.length > 0 && !column[column.length - 1].faceUp) {
          column[column.length - 1] = { ...column[column.length - 1], faceUp: true };
        }
        newTableau[fromLocation.index] = column;
        newState = {
          ...state,
          tableau: newTableau,
          foundations: newFoundations,
          moveCount: state.moveCount + 1,
        };
      } else {
        return null;
      }

      // Check for win
      if (checkWin(newState.foundations)) {
        newState.gameWon = true;
      }

      return newState;
    }
    return null;
  }, []);

  const handleWasteClick = useCallback(() => {
    if (gameState.waste.length === 0) return;

    const topCard = gameState.waste[gameState.waste.length - 1];
    const fromLocation: Location = { zone: 'waste' };

    if (selectedLocation?.zone === 'waste') {
      // Double-click behavior: try to auto-move to foundation
      const newState = tryMoveToFoundation(topCard, fromLocation, startGameIfNeeded(gameState));
      if (newState) {
        saveToHistory(gameState);
        setGameState(newState);
        setSelectedLocation(null);
        return;
      }
    }

    setSelectedLocation(fromLocation);
  }, [gameState, selectedLocation, startGameIfNeeded, tryMoveToFoundation, saveToHistory]);

  const handleTableauCardClick = useCallback((columnIndex: number, cardIndex: number) => {
    const column = gameState.tableau[columnIndex];
    const card = column[cardIndex];

    if (!card.faceUp) return;

    const clickedLocation: Location = { zone: 'tableau', index: columnIndex, cardIndex };

    // If clicking the same card that's selected, try to auto-move to foundation (only single card)
    if (
      selectedLocation?.zone === 'tableau' &&
      selectedLocation.index === columnIndex &&
      selectedLocation.cardIndex === cardIndex &&
      cardIndex === column.length - 1 // Only auto-move if it's the top card
    ) {
      const newState = tryMoveToFoundation(card, clickedLocation, startGameIfNeeded(gameState));
      if (newState) {
        saveToHistory(gameState);
        setGameState(newState);
        setSelectedLocation(null);
        return;
      }
    }

    // If we have a selection, try to move
    if (selectedLocation) {
      const cardsToMove = getSelectedCards();
      if (cardsToMove && canPlaceOnTableau(cardsToMove, column)) {
        saveToHistory(gameState);
        setGameState(prev => {
          const state = startGameIfNeeded(prev);
          return moveCards(state, selectedLocation, { zone: 'tableau', index: columnIndex });
        });
        setSelectedLocation(null);
        return;
      }
    }

    // Select this card (and all cards below it)
    setSelectedLocation(clickedLocation);
  }, [gameState, selectedLocation, startGameIfNeeded, tryMoveToFoundation, saveToHistory]);

  const handleTableauDrop = useCallback((columnIndex: number) => {
    if (!dragSource) return;

    const cardsToMove = getDraggedCards();
    if (!cardsToMove) return;

    const column = gameState.tableau[columnIndex];

    if (canPlaceOnTableau(cardsToMove, column)) {
      saveToHistory(gameState);
      setGameState(prev => {
        const state = startGameIfNeeded(prev);
        return moveCards(state, dragSource, { zone: 'tableau', index: columnIndex });
      });
    }

    setDragSource(null);
    setSelectedLocation(null);
  }, [dragSource, gameState, startGameIfNeeded, saveToHistory]);

  const handleFoundationDrop = useCallback((foundationIndex: number) => {
    if (!dragSource) return;

    const cardsToMove = getDraggedCards();
    if (!cardsToMove || cardsToMove.length !== 1) return;

    const card = cardsToMove[0];
    if (canPlaceOnFoundation(card, gameState.foundations[foundationIndex], foundationIndex)) {
      saveToHistory(gameState);
      setGameState(prev => {
        let state = startGameIfNeeded(prev);
        state = moveCards(state, dragSource, { zone: 'foundation', index: foundationIndex });
        if (checkWin(state.foundations)) {
          state.gameWon = true;
        }
        return state;
      });
    }

    setDragSource(null);
    setSelectedLocation(null);
  }, [dragSource, gameState, startGameIfNeeded, saveToHistory]);

  const handleDragStart = useCallback((e: React.DragEvent, location: Location) => {
    setDragSource(location);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragSource(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const getSelectedCards = useCallback((): Card[] | null => {
    if (!selectedLocation) return null;

    if (selectedLocation.zone === 'waste') {
      if (gameState.waste.length === 0) return null;
      return [gameState.waste[gameState.waste.length - 1]];
    }

    if (selectedLocation.zone === 'tableau' && selectedLocation.index !== undefined && selectedLocation.cardIndex !== undefined) {
      const column = gameState.tableau[selectedLocation.index];
      return column.slice(selectedLocation.cardIndex);
    }

    return null;
  }, [selectedLocation, gameState]);

  const getDraggedCards = useCallback((): Card[] | null => {
    if (!dragSource) return null;

    if (dragSource.zone === 'waste') {
      if (gameState.waste.length === 0) return null;
      return [gameState.waste[gameState.waste.length - 1]];
    }

    if (dragSource.zone === 'tableau' && dragSource.index !== undefined && dragSource.cardIndex !== undefined) {
      const column = gameState.tableau[dragSource.index];
      return column.slice(dragSource.cardIndex);
    }

    return null;
  }, [dragSource, gameState]);

  const moveCards = (state: GameState, from: Location, to: Location): GameState => {
    let newState = { ...state };
    let cardsToMove: Card[] = [];

    // Remove cards from source
    if (from.zone === 'waste') {
      cardsToMove = [state.waste[state.waste.length - 1]];
      newState.waste = state.waste.slice(0, -1);
    } else if (from.zone === 'tableau' && from.index !== undefined && from.cardIndex !== undefined) {
      const column = [...state.tableau[from.index]];
      cardsToMove = column.slice(from.cardIndex);
      const remaining = column.slice(0, from.cardIndex);
      // Flip the new top card if needed
      if (remaining.length > 0 && !remaining[remaining.length - 1].faceUp) {
        remaining[remaining.length - 1] = { ...remaining[remaining.length - 1], faceUp: true };
      }
      const newTableau = [...state.tableau] as GameState['tableau'];
      newTableau[from.index] = remaining;
      newState.tableau = newTableau;
    }

    // Add cards to destination
    if (to.zone === 'tableau' && to.index !== undefined) {
      const newTableau = [...newState.tableau] as GameState['tableau'];
      newTableau[to.index] = [...newTableau[to.index], ...cardsToMove.map(c => ({ ...c, faceUp: true }))];
      newState.tableau = newTableau;
    } else if (to.zone === 'foundation' && to.index !== undefined) {
      const newFoundations = [...newState.foundations] as GameState['foundations'];
      newFoundations[to.index] = [...newFoundations[to.index], { ...cardsToMove[0], faceUp: true }];
      newState.foundations = newFoundations;
    }

    newState.moveCount = state.moveCount + 1;
    return newState;
  };

  // Handle clicking on empty tableau column or foundation
  const handleEmptyTableauClick = useCallback((columnIndex: number) => {
    if (!selectedLocation) return;

    const cardsToMove = getSelectedCards();
    if (!cardsToMove) return;

    const column = gameState.tableau[columnIndex];
    if (canPlaceOnTableau(cardsToMove, column)) {
      saveToHistory(gameState);
      setGameState(prev => {
        const state = startGameIfNeeded(prev);
        return moveCards(state, selectedLocation, { zone: 'tableau', index: columnIndex });
      });
      setSelectedLocation(null);
    }
  }, [selectedLocation, getSelectedCards, gameState, startGameIfNeeded, saveToHistory]);

  return (
    <div className="solitaire-game">
      <GameControls
        onNewGame={handleNewGame}
        onUndo={handleUndo}
        canUndo={history.length > 0}
        moveCount={gameState.moveCount}
        elapsedTime={elapsedTime}
        translations={t}
      />

      <div className="solitaire-board">
        <div className="top-row">
          <div className="stock-waste-area">
            <Stock cards={gameState.stock} onClick={handleStockClick} />
            <Waste
              cards={gameState.waste}
              onCardClick={handleWasteClick}
              onDragStart={(e) => handleDragStart(e, { zone: 'waste' })}
              onDragEnd={handleDragEnd}
              selectedCard={selectedLocation?.zone === 'waste'}
            />
          </div>

          <Foundation
            piles={gameState.foundations}
            onDrop={handleFoundationDrop}
            onDragOver={handleDragOver}
          />
        </div>

        <Tableau
          columns={gameState.tableau}
          onCardClick={handleTableauCardClick}
          onDragStart={(e, columnIndex, cardIndex) =>
            handleDragStart(e, { zone: 'tableau', index: columnIndex, cardIndex })
          }
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDrop={handleTableauDrop}
          selectedColumn={selectedLocation?.zone === 'tableau' ? selectedLocation.index : undefined}
          selectedCardIndex={selectedLocation?.zone === 'tableau' ? selectedLocation.cardIndex : undefined}
        />
      </div>

      {showWinAnimation && (
        <WinAnimation
          foundations={gameState.foundations}
          onComplete={handleWinAnimationComplete}
        />
      )}

      {showWinDialog && (
        <WinDialog
          moveCount={gameState.moveCount}
          elapsedTime={elapsedTime}
          onPlayAgain={handleNewGame}
          translations={t}
        />
      )}
    </div>
  );
}
