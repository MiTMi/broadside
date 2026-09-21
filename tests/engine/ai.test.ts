import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  chooseShot,
  emptyBoard,
  fire,
  mulberry32,
  placeShip,
  randomFleet,
  shipCells,
  toOpponentView,
  type Board,
  type Coord,
  type Difficulty,
} from '../../src/engine/index';
import { key, playSolo, spec } from './helpers';

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

describe('chooseShot', () => {
  it.each(DIFFICULTIES)('%s never repeats a cell and always finishes the fleet', (difficulty) => {
    for (let seed = 0; seed < 25; seed++) {
      const rng = mulberry32(seed + 1000);
      const result = playSolo(randomFleet(mulberry32(seed)), difficulty, rng);
      expect(new Set(result.fired.map(key)).size).toBe(result.fired.length);
      expect(result.shots).toBeLessThanOrEqual(BOARD_SIZE * BOARD_SIZE);
    }
  });

  it.each(DIFFICULTIES)('%s never fires at clear water', (difficulty) => {
    // One ship sunk up front puts a ring of clear water on the board; every
    // later shot must avoid it (playSolo asserts each target is 'unknown').
    for (let seed = 0; seed < 10; seed++) {
      let board = randomFleet(mulberry32(seed));
      const victim = board.ships[0];
      expect(victim).toBeDefined();
      for (const cell of shipCells(victim as NonNullable<typeof victim>)) board = fire(board, cell).board;
      const view = toOpponentView(board);
      expect(view.cells.flat().filter((c) => c === 'clear').length).toBeGreaterThan(0);
      playSolo(board, difficulty, mulberry32(seed + 77));
    }
  });

  it.each(DIFFICULTIES)('%s is deterministic for a given seed', (difficulty) => {
    const view = toOpponentView(randomFleet(mulberry32(5)));
    const a = chooseShot(view, difficulty, mulberry32(11));
    const b = chooseShot(view, difficulty, mulberry32(11));
    expect(a).toEqual(b);
  });

  it('throws when there is nothing left to fire at', () => {
    let board = emptyBoard();
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) board = fire(board, { row, col }).board;
    }
    expect(() => chooseShot(toOpponentView(board), 'hard', mulberry32(1))).toThrow(/no cells left/);
  });

  it('follows the line once two hits align (normal and hard)', () => {
    // A lone cruiser with two hits in a row: the only sensible shots are the
    // two cells extending that line.
    let board = placeShip(emptyBoard(), spec('cruiser'), { row: 6, col: 4 }, 'h');
    board = fire(board, { row: 6, col: 4 }).board;
    board = fire(board, { row: 6, col: 5 }).board;
    const view = toOpponentView(board);
    const ends: Coord[] = [
      { row: 6, col: 3 },
      { row: 6, col: 6 },
    ];
    for (const difficulty of ['normal', 'hard'] as const) {
      for (let seed = 0; seed < 20; seed++) {
        const shot = chooseShot(view, difficulty, mulberry32(seed));
        expect(ends.some((e) => e.row === shot.row && e.col === shot.col)).toBe(true);
      }
    }
  });

  it('pokes around an isolated hit (all difficulties)', () => {
    let board = placeShip(emptyBoard(), spec('cruiser'), { row: 6, col: 4 }, 'h');
    board = fire(board, { row: 6, col: 5 }).board;
    const view = toOpponentView(board);
    for (const difficulty of DIFFICULTIES) {
      for (let seed = 0; seed < 20; seed++) {
        const shot = chooseShot(view, difficulty, mulberry32(seed));
        expect(Math.abs(shot.row - 6) + Math.abs(shot.col - 5)).toBe(1);
      }
    }
  });

  it('hard ignores cells no remaining ship can fit into', () => {
    // Box a single cell in with misses: nothing can be hiding there, so the
    // density map must send the shot somewhere else.
    let board = randomFleet(mulberry32(12));
    board = clearArea(board);
    for (const c of [
      { row: 0, col: 1 },
      { row: 1, col: 0 },
    ]) {
      board = fire(board, c).board;
    }
    const view = toOpponentView(board);
    expect(view.cells[0]?.[0]).toBe('unknown');
    for (let seed = 0; seed < 30; seed++) {
      const shot = chooseShot(view, 'hard', mulberry32(seed));
      expect(shot).not.toEqual({ row: 0, col: 0 });
    }
  });

  it('hard stays well under 20ms per call', () => {
    let board = randomFleet(mulberry32(21));
    const rng = mulberry32(99);
    let worst = 0;
    let total = 0;
    let calls = 0;

    for (let shot = 0; shot < 60; shot++) {
      const view = toOpponentView(board);
      if (view.remaining.length === 0) break;
      const start = performance.now();
      const coord = chooseShot(view, 'hard', rng);
      const elapsed = performance.now() - start;
      worst = Math.max(worst, elapsed);
      total += elapsed;
      calls += 1;
      board = fire(board, coord).board;
    }

    console.log(`hard chooseShot: ${calls} calls, mean ${(total / calls).toFixed(2)}ms, worst ${worst.toFixed(2)}ms`);
    expect(worst).toBeLessThan(20);
  });
});

/** Drops every ship sitting in the top-left corner region. */
function clearArea(board: Board): Board {
  return { ...board, ships: board.ships.filter((s) => s.origin.row > 2 || s.origin.col > 2) };
}
