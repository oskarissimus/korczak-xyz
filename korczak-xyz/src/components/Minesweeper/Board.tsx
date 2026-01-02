import type { Cell as CellType } from '../../utils/minesweeper/types';
import Cell from './Cell';

interface BoardProps {
  board: CellType[][];
  gameOver: boolean;
  onReveal: (row: number, col: number) => void;
  onFlag: (row: number, col: number) => void;
  flagMode: boolean;
}

export default function Board({ board, gameOver, onReveal, onFlag, flagMode }: BoardProps) {
  return (
    <div className="minesweeper-board">
      {board.map((row, rowIndex) => (
        <div key={rowIndex} className="minesweeper-row">
          {row.map((cell) => (
            <Cell
              key={`${cell.row}-${cell.col}`}
              cell={cell}
              gameOver={gameOver}
              onReveal={onReveal}
              onFlag={onFlag}
              flagMode={flagMode}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
