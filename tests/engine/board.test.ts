import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  FLEET,
  FLEET_CELLS,
  allSunk,
  canPlace,
  emptyBoard,
  fire,
  haloCells,
  isClearWater,
  isFleetComplete,
  isSunk,
  mulberry32,
  placeShip,
  randomFleet,
  removeShip,
  shipAt,
  shipCells,
  type Board,
} from '../../src/engine/index';
import { expectLegalFleet, key, spec } from './helpers';

describe('fleet', () => {
  it('is the user-specified 8 ships of 5/4/3/3/3/2/2/2', () => {
    expect(FLEET.map((s) => s.length)).toEqual([5, 4, 3, 3, 3, 2, 2, 2]);
    expect(FLEET).toHaveLength(8);
    expect(FLEET_CELLS).toBe(24);
    expect(new Set(FLEET.map((s) => s.id)).size).toBe(8);
  });
});

describe('emptyBoard / shipCells', () => {
  it('starts with no ships and no shots', () => {
    const board = emptyBoard();
    expect(board.ships).toHaveLength(0);
    expect(board.shots).toHaveLength(BOARD_SIZE);
    expect(board.shots.every((row) => row.length === BOARD_SIZE && row.every((m) => m === null))).toBe(true);
  });

  it('extends horizontally to increasing col and vertically to increasing row', () => {
    expect(shipCells({ spec: spec('cruiser'), origin: { row: 3, col: 3 }, orientation: 'h' })).toEqual([
      { row: 3, col: 3 },
      { row: 3, col: 4 },
      { row: 3, col: 5 },
    ]);
    expect(shipCells({ spec: spec('cruiser'), origin: { row: 3, col: 3 }, orientation: 'v' })).toEqual([
      { row: 3, col: 3 },
      { row: 4, col: 3 },
      { row: 5, col: 3 },
    ]);
  });
});

describe('canPlace', () => {
  const withCruiser = (): Board => placeShip(emptyBoard(), spec('cruiser'), { row: 3, col: 3 }, 'h'); // D4-D6

  it('keeps ships on the board', () => {
    const board = emptyBoard();
    expect(canPlace(board, spec('carrier'), { row: 0, col: BOARD_SIZE - 5 }, 'h')).toBe(true);
    expect(canPlace(board, spec('carrier'), { row: 0, col: BOARD_SIZE - 4 }, 'h')).toBe(false);
    expect(canPlace(board, spec('carrier'), { row: BOARD_SIZE - 5, col: 0 }, 'v')).toBe(true);
    expect(canPlace(board, spec('carrier'), { row: BOARD_SIZE - 4, col: 0 }, 'v')).toBe(false);
    expect(canPlace(board, spec('patrol'), { row: -1, col: 0 }, 'h')).toBe(false);
  });

  it('rejects overlap', () => {
    expect(canPlace(withCruiser(), spec('destroyer'), { row: 3, col: 4 }, 'v')).toBe(false);
    expect(canPlace(withCruiser(), spec('destroyer'), { row: 3, col: 3 }, 'h')).toBe(false);
  });

  it('rejects touching by edge', () => {
    const board = withCruiser();
    expect(canPlace(board, spec('destroyer'), { row: 3, col: 6 }, 'h')).toBe(false); // end to end
    expect(canPlace(board, spec('destroyer'), { row: 3, col: 1 }, 'h')).toBe(false); // ends at col 2, touches col 3
    expect(canPlace(board, spec('destroyer'), { row: 2, col: 4 }, 'h')).toBe(false); // directly above
    expect(canPlace(board, spec('destroyer'), { row: 4, col: 4 }, 'h')).toBe(false); // directly below
  });

  it('rejects touching by corner', () => {
    const board = withCruiser();
    expect(canPlace(board, spec('destroyer'), { row: 2, col: 6 }, 'h')).toBe(false); // diagonal off D6
    expect(canPlace(board, spec('destroyer'), { row: 4, col: 6 }, 'h')).toBe(false);
    expect(canPlace(board, spec('destroyer'), { row: 1, col: 2 }, 'v')).toBe(false); // ends at C3, diagonal off D4
    expect(canPlace(board, spec('destroyer'), { row: 4, col: 1 }, 'h')).toBe(false); // ends at E3, diagonal off D4
  });

  it('accepts a one-cell gap', () => {
    const board = withCruiser();
    expect(canPlace(board, spec('destroyer'), { row: 3, col: 7 }, 'h')).toBe(true); // one clear column
    expect(canPlace(board, spec('destroyer'), { row: 1, col: 4 }, 'h')).toBe(true); // one clear row above
    expect(canPlace(board, spec('destroyer'), { row: 5, col: 4 }, 'h')).toBe(true); // one clear row below
    expect(canPlace(board, spec('destroyer'), { row: 1, col: 1 }, 'v')).toBe(true); // ends at C2, one clear diagonal
  });
});

describe('haloCells', () => {
  it('is the in-bounds 8-neighbourhood minus the ship itself', () => {
    const halo = haloCells({ spec: spec('cruiser'), origin: { row: 3, col: 3 }, orientation: 'h' });
    expect(halo).toHaveLength(12); // 2 * 3 + 6 for a length-3 ship in open water
    expect(halo.some((c) => c.row === 3 && c.col === 4)).toBe(false); // never its own cells
    for (const c of [
      { row: 2, col: 2 },
      { row: 2, col: 6 },
      { row: 4, col: 6 },
      { row: 3, col: 2 },
    ]) {
      expect(halo.some((h) => h.row === c.row && h.col === c.col)).toBe(true);
    }
  });

  it('clips at the board edge and never repeats a cell', () => {
    const halo = haloCells({ spec: spec('destroyer'), origin: { row: 0, col: 0 }, orientation: 'h' });
    expect(halo).toHaveLength(4);
    expect(new Set(halo.map(key)).size).toBe(halo.length);
  });
});

describe('placeShip / removeShip / shipAt / isFleetComplete', () => {
  it('returns a new board and leaves the old one alone', () => {
    const board = emptyBoard();
    const next = placeShip(board, spec('cruiser'), { row: 3, col: 3 }, 'h');
    expect(board.ships).toHaveLength(0);
    expect(next.ships).toHaveLength(1);
  });

  it('throws on an illegal placement', () => {
    const board = placeShip(emptyBoard(), spec('cruiser'), { row: 3, col: 3 }, 'h');
    expect(() => placeShip(board, spec('destroyer'), { row: 2, col: 6 }, 'h')).toThrow(/cannot place/);
    expect(() => placeShip(emptyBoard(), spec('carrier'), { row: 0, col: 10 }, 'h')).toThrow(/cannot place/);
  });

  it('throws when a ship id is already placed', () => {
    const board = placeShip(emptyBoard(), spec('cruiser'), { row: 3, col: 3 }, 'h');
    expect(() => placeShip(board, spec('cruiser'), { row: 8, col: 8 }, 'h')).toThrow(/already placed/);
  });

  it('finds and removes ships by id', () => {
    const board = placeShip(emptyBoard(), spec('cruiser'), { row: 3, col: 3 }, 'h');
    expect(shipAt(board, { row: 3, col: 5 })?.spec.id).toBe('cruiser');
    expect(shipAt(board, { row: 3, col: 6 })).toBeUndefined();
    expect(removeShip(board, 'cruiser').ships).toHaveLength(0);
    expect(removeShip(board, 'patrol').ships).toHaveLength(1);
  });

  it('is complete only with all eight ships', () => {
    const full = randomFleet(mulberry32(1));
    expect(isFleetComplete(full)).toBe(true);
    expect(isFleetComplete(removeShip(full, 'patrol'))).toBe(false);
    expect(isFleetComplete(emptyBoard())).toBe(false);
  });
});

describe('randomFleet', () => {
  it('produces a legal fleet for 500 seeds', () => {
    for (let seed = 0; seed < 500; seed++) {
      expectLegalFleet(randomFleet(mulberry32(seed)));
    }
  });

  it('is deterministic for a given seed and varies between seeds', () => {
    expect(randomFleet(mulberry32(42))).toEqual(randomFleet(mulberry32(42)));
    expect(randomFleet(mulberry32(42))).not.toEqual(randomFleet(mulberry32(43)));
  });
});

describe('fire', () => {
  const board = placeShip(
    placeShip(emptyBoard(), spec('cruiser'), { row: 3, col: 3 }, 'h'),
    spec('destroyer'),
    { row: 8, col: 8 },
    'v',
  );

  it('reports miss, hit and sunk', () => {
    const miss = fire(board, { row: 0, col: 0 });
    expect(miss.outcome).toBe('miss');
    expect(miss.ship).toBeUndefined();
    expect(miss.board.shots[0]?.[0]).toBe('miss');

    const hit = fire(board, { row: 8, col: 8 });
    expect(hit.outcome).toBe('hit');
    expect(hit.ship?.spec.id).toBe('destroyer');
    expect(isSunk(hit.board, hit.ship as NonNullable<typeof hit.ship>)).toBe(false);

    const sunk = fire(hit.board, { row: 9, col: 8 });
    expect(sunk.outcome).toBe('sunk');
    expect(sunk.ship?.spec.id).toBe('destroyer');
    expect(isSunk(sunk.board, sunk.ship as NonNullable<typeof sunk.ship>)).toBe(true);
    expect(allSunk(sunk.board)).toBe(false);
  });

  it('throws on a repeat shot or an off-board shot', () => {
    const once = fire(board, { row: 0, col: 0 }).board;
    expect(() => fire(once, { row: 0, col: 0 })).toThrow(/already been fired at/);
    expect(() => fire(board, { row: BOARD_SIZE, col: 0 })).toThrow(/out of bounds/);
    expect(() => fire(board, { row: 0, col: -1 })).toThrow(/out of bounds/);
  });

  it('leaves the previous board untouched', () => {
    fire(board, { row: 0, col: 0 });
    expect(board.shots[0]?.[0]).toBeNull();
  });

  it('reports allSunk once every ship is gone', () => {
    let current = board;
    for (const ship of board.ships) {
      for (const cell of shipCells(ship)) current = fire(current, cell).board;
    }
    expect(allSunk(current)).toBe(true);
  });
});

describe('isClearWater', () => {
  it('marks un-fired cells around a sunk ship and nothing else', () => {
    let board = placeShip(
      placeShip(emptyBoard(), spec('destroyer'), { row: 5, col: 5 }, 'h'),
      spec('cruiser'),
      { row: 0, col: 0 },
      'h',
    );
    expect(isClearWater(board, { row: 4, col: 5 })).toBe(false); // nothing sunk yet

    board = fire(board, { row: 4, col: 4 }).board; // a miss inside the future halo
    board = fire(board, { row: 5, col: 5 }).board;
    expect(isClearWater(board, { row: 4, col: 5 })).toBe(false); // hit, not sunk

    board = fire(board, { row: 5, col: 6 }).board; // destroyer sunk
    expect(isClearWater(board, { row: 4, col: 5 })).toBe(true);
    expect(isClearWater(board, { row: 6, col: 7 })).toBe(true); // diagonal counts
    expect(isClearWater(board, { row: 4, col: 4 })).toBe(false); // already fired at
    expect(isClearWater(board, { row: 5, col: 5 })).toBe(false); // the ship itself
    expect(isClearWater(board, { row: 5, col: 8 })).toBe(false); // two cells away
    expect(isClearWater(board, { row: 0, col: 3 })).toBe(false); // halo of an unsunk ship
    expect(isClearWater(board, { row: -1, col: 5 })).toBe(false); // off board
  });
});
