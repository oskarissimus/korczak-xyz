import type { Cell as CellType } from '../../utils/minesweeper/types';

interface CellProps {
  cell: CellType;
  gameOver: boolean;
  onReveal: (row: number, col: number) => void;
  onFlag: (row: number, col: number) => void;
}

const NUMBER_COLORS: Record<number, string> = {
  1: '#0000ff', // blue
  2: '#008000', // green
  3: '#ff0000', // red
  4: '#000080', // dark blue
  5: '#800000', // maroon
  6: '#008080', // teal
  7: '#000000', // black
  8: '#808080', // gray
};

export default function Cell({ cell, gameOver, onReveal, onFlag }: CellProps) {
  const handleClick = () => {
    if (gameOver || cell.state === 'flagged') return;
    onReveal(cell.row, cell.col);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (gameOver || cell.state === 'revealed') return;
    onFlag(cell.row, cell.col);
  };

  const isRevealed = cell.state === 'revealed';
  const isFlagged = cell.state === 'flagged';
  const isExploded = isRevealed && cell.isMine;

  let content = '';
  let style: React.CSSProperties = {};

  if (isRevealed) {
    if (cell.isMine) {
      content = '\u{1F4A3}'; // bomb emoji
    } else if (cell.adjacentMines > 0) {
      content = String(cell.adjacentMines);
      style.color = NUMBER_COLORS[cell.adjacentMines];
      style.fontWeight = 'bold';
    }
  } else if (isFlagged) {
    content = '\u{1F6A9}'; // flag emoji
  }

  const cellClass = [
    'minesweeper-cell',
    isRevealed ? 'revealed' : 'hidden',
    isExploded ? 'exploded' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={cellClass}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      disabled={gameOver && !isRevealed}
      style={style}
    >
      {content}
    </button>
  );
}
