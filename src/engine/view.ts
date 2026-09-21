import { BOARD_SIZE } from './types';
import type { Board, OpponentView, PlacedShip, ViewCell } from './types';
import { clearWaterKeys, isSunk, shipCells } from './board';
import { cellKey } from './coords';

/**
 * Everything an opponent legitimately knows. Un-fired cells are 'unknown' (or
 * 'clear' next to a sunk ship) whether or not a ship is hiding there, so this
 * view can never leak the position of an unsunk ship.
 */
export function toOpponentView(board: Board): OpponentView {
  const sunk: PlacedShip[] = [];
  const remaining: PlacedShip[] = [];
  for (const ship of board.ships) (isSunk(board, ship) ? sunk : remaining).push(ship);

  const sunkCells = new Set<number>();
  for (const ship of sunk) {
    for (const cell of shipCells(ship)) sunkCells.add(cellKey(cell));
  }
  const clearCells = clearWaterKeys(board);

  const cells: ViewCell[][] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    const line: ViewCell[] = [];
    for (let col = 0; col < BOARD_SIZE; col++) {
      const mark = board.shots[row]?.[col] ?? null;
      const k = cellKey({ row, col });
      if (mark === 'hit') line.push(sunkCells.has(k) ? 'sunk' : 'hit');
      else if (mark === 'miss') line.push('miss');
      else line.push(clearCells.has(k) ? 'clear' : 'unknown');
    }
    cells.push(line);
  }

  return { cells, remaining: remaining.map((ship) => ship.spec), sunk };
}
