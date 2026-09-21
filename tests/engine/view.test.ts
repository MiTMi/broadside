import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  FLEET,
  emptyBoard,
  fire,
  mulberry32,
  placeShip,
  randomFleet,
  shipCells,
  toOpponentView,
  type Board,
} from '../../src/engine/index';
import { spec } from './helpers';

const twoShips = (): Board =>
  placeShip(placeShip(emptyBoard(), spec('destroyer'), { row: 5, col: 5 }, 'h'), spec('cruiser'), { row: 0, col: 0 }, 'h');

describe('toOpponentView', () => {
  it('shows nothing but unknown cells before the first shot', () => {
    const view = toOpponentView(randomFleet(mulberry32(7)));
    expect(view.cells.flat().every((c) => c === 'unknown')).toBe(true);
    expect(view.remaining).toHaveLength(FLEET.length);
    expect(view.sunk).toHaveLength(0);
  });

  it('never leaks the position of an unsunk ship', () => {
    // Same shots, different fleets: the parts of the view an opponent can see
    // must be identical wherever no ship has been sunk.
    for (let seed = 0; seed < 40; seed++) {
      let board = randomFleet(mulberry32(seed));
      const shots = [
        { row: 2, col: 2 },
        { row: 4, col: 7 },
        { row: 9, col: 1 },
      ];
      for (const shot of shots) board = fire(board, shot).board;
      const view = toOpponentView(board);

      for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
          const fired = shots.some((s) => s.row === row && s.col === col);
          const cell = view.cells[row]?.[col];
          if (!fired) expect(cell).toBe('unknown'); // nothing sunk yet, so no 'clear' either
          else expect(cell === 'hit' || cell === 'miss').toBe(true);
        }
      }
      // remaining exposes specs only — no coordinates ride along
      expect(view.remaining.every((s) => Object.keys(s).sort().join() === 'id,length,name')).toBe(true);
    }
  });

  it('reveals a sunk ship and rings it with clear water', () => {
    let board = twoShips();
    board = fire(board, { row: 4, col: 4 }).board; // a miss in the halo
    board = fire(board, { row: 5, col: 5 }).board;
    expect(toOpponentView(board).cells[5]?.[5]).toBe('hit');
    expect(toOpponentView(board).cells[4]?.[5]).toBe('unknown');

    board = fire(board, { row: 5, col: 6 }).board; // sunk
    const view = toOpponentView(board);
    expect(view.cells[5]?.[5]).toBe('sunk');
    expect(view.cells[5]?.[6]).toBe('sunk');
    expect(view.cells[4]?.[5]).toBe('clear');
    expect(view.cells[6]?.[7]).toBe('clear'); // diagonal
    expect(view.cells[4]?.[4]).toBe('miss'); // a fired cell stays a miss
    expect(view.cells[5]?.[8]).toBe('unknown'); // outside the halo
    expect(view.sunk.map((s) => s.spec.id)).toEqual(['destroyer']);
    expect(view.remaining.map((s) => s.id)).toEqual(['cruiser']);
  });

  it('shows hits on an unsunk ship as hit, not sunk', () => {
    let board = twoShips();
    for (const cell of shipCells({ spec: spec('cruiser'), origin: { row: 0, col: 0 }, orientation: 'h' }).slice(0, 2)) {
      board = fire(board, cell).board;
    }
    const view = toOpponentView(board);
    expect(view.cells[0]?.[0]).toBe('hit');
    expect(view.cells[0]?.[1]).toBe('hit');
    expect(view.cells[0]?.[2]).toBe('unknown');
    expect(view.sunk).toHaveLength(0);
    expect(view.remaining).toHaveLength(2);
  });
});
