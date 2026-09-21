import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  applyShotResult,
  emptyBoard,
  emptyRemoteView,
  fire,
  mulberry32,
  placeShip,
  randomFleet,
  toOpponentView,
  type Board,
  type Coord,
  type OpponentView,
  type PlacedShip,
  type Rng,
  type ShotRecord,
} from '../../src/engine/index';
import { spec } from './helpers';

/** What the target sends back: a plain hit never names its ship (Decision D1). */
function record(coord: Coord, result: { outcome: 'miss' | 'hit' | 'sunk'; ship?: PlacedShip }): ShotRecord {
  return {
    coord,
    outcome: result.outcome,
    ...(result.outcome === 'sunk' && result.ship ? { ship: result.ship } : {}),
  };
}

/** A cell the shooter is still allowed to fire at — never clear water, never twice. */
function pickUnknown(view: OpponentView, rng: Rng): Coord {
  const options: Coord[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (view.cells[row]?.[col] === 'unknown') options.push({ row, col });
    }
  }
  const choice = options[Math.floor(rng() * options.length)];
  if (!choice) throw new Error('pickUnknown: nothing left to fire at');
  return choice;
}

const destroyer = (): PlacedShip => ({ spec: spec('destroyer'), origin: { row: 5, col: 5 }, orientation: 'h' });

const twoShips = (): Board =>
  placeShip(placeShip(emptyBoard(), spec('destroyer'), { row: 5, col: 5 }, 'h'), spec('cruiser'), { row: 0, col: 0 }, 'h');

describe('emptyRemoteView', () => {
  it('is what the opponent sees before the first shot', () => {
    expect(emptyRemoteView()).toEqual(toOpponentView(randomFleet(mulberry32(3))));
  });
});

describe('applyShotResult', () => {
  it('rebuilds the opponent view exactly, shot after shot, over 200 seeded games', () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = mulberry32(seed);
      let board = randomFleet(rng);
      let view = emptyRemoteView();
      expect(view).toEqual(toOpponentView(board));

      let shots = 0;
      while (toOpponentView(board).remaining.length > 0) {
        const coord = pickUnknown(view, rng);
        const result = fire(board, coord);
        board = result.board;
        view = applyShotResult(view, record(coord, result));
        // Every shot, not just the last one: clear water and sunk reveals included.
        expect(view, `seed ${seed}, shot ${shots}`).toEqual(toOpponentView(board));
        shots++;
        if (shots > BOARD_SIZE * BOARD_SIZE) throw new Error(`seed ${seed}: game did not finish`);
      }
      expect(view.sunk).toHaveLength(board.ships.length);
      expect(view.remaining).toHaveLength(0);
    }
  });

  it('marks clear water around a sunk ship and leaves fired cells alone', () => {
    let board = twoShips();
    let view = emptyRemoteView();
    for (const coord of [{ row: 4, col: 4 }, { row: 5, col: 5 }, { row: 5, col: 6 }]) {
      const result = fire(board, coord);
      board = result.board;
      view = applyShotResult(view, record(coord, result));
    }
    expect(view.cells[5]?.[5]).toBe('sunk');
    expect(view.cells[4]?.[5]).toBe('clear');
    expect(view.cells[6]?.[7]).toBe('clear');
    expect(view.cells[4]?.[4]).toBe('miss');
    expect(view.cells[5]?.[8]).toBe('unknown');
    expect(view.sunk.map((ship) => ship.spec.id)).toEqual(['destroyer']);
    expect(view.remaining.map((s) => s.id)).not.toContain('destroyer');
    // Cells only: this test board holds two ships, while a remote view always
    // starts from the full fleet (a shooter is told nothing about what is out there).
    expect(view.cells).toEqual(toOpponentView(board).cells);
  });

  it('never leaks an unsunk ship: a hit names nothing', () => {
    const view = applyShotResult(emptyRemoteView(), { coord: { row: 5, col: 5 }, outcome: 'hit' });
    expect(view.cells[5]?.[5]).toBe('hit');
    expect(view.sunk).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('origin');
  });

  it('keeps remaining and sunk in fleet order, not sink order', () => {
    let board = randomFleet(mulberry32(11));
    let view = emptyRemoteView();
    // Sink the ships in reverse fleet order.
    for (const ship of [...board.ships].reverse()) {
      for (const cell of [...board.ships.filter((s) => s.spec.id === ship.spec.id)].flatMap((s) =>
        s.orientation === 'h'
          ? Array.from({ length: s.spec.length }, (_, i) => ({ row: s.origin.row, col: s.origin.col + i }))
          : Array.from({ length: s.spec.length }, (_, i) => ({ row: s.origin.row + i, col: s.origin.col })),
      )) {
        if (view.cells[cell.row]?.[cell.col] !== 'unknown') continue;
        const result = fire(board, cell);
        board = result.board;
        view = applyShotResult(view, record(cell, result));
      }
    }
    expect(view).toEqual(toOpponentView(board));
  });

  it('throws on out of bounds, a known cell, and a sunk without its ship', () => {
    const view = applyShotResult(emptyRemoteView(), { coord: { row: 0, col: 0 }, outcome: 'miss' });
    expect(() => applyShotResult(view, { coord: { row: -1, col: 0 }, outcome: 'miss' })).toThrow(/out of bounds/);
    expect(() => applyShotResult(view, { coord: { row: 0, col: BOARD_SIZE }, outcome: 'miss' })).toThrow(/out of bounds/);
    expect(() => applyShotResult(view, { coord: { row: 0, col: 0 }, outcome: 'hit' })).toThrow(/already known/);
    expect(() => applyShotResult(view, { coord: { row: 3, col: 3 }, outcome: 'sunk' })).toThrow(/must name the ship/);
  });

  it('rejects a sunk ship whose geometry contradicts what is known', () => {
    const fresh = emptyRemoteView();
    // The destroyer is 2 cells: its other cell is not a known hit yet.
    expect(() => applyShotResult(fresh, record({ row: 5, col: 5 }, { outcome: 'sunk', ship: destroyer() }))).toThrow(
      /not a known hit/,
    );

    const hit = applyShotResult(fresh, { coord: { row: 5, col: 6 }, outcome: 'hit' });
    // A coord that is not part of the reported ship.
    expect(() => applyShotResult(hit, record({ row: 0, col: 0 }, { outcome: 'sunk', ship: destroyer() }))).toThrow(
      /not part of the destroyer/,
    );

    const sunk = applyShotResult(hit, record({ row: 5, col: 5 }, { outcome: 'sunk', ship: destroyer() }));
    expect(() => applyShotResult(sunk, record({ row: 8, col: 8 }, { outcome: 'sunk', ship: destroyer() }))).toThrow(
      /already been sunk/,
    );

    const lying: PlacedShip = { spec: { id: 'destroyer', name: 'destroyer', length: 5 }, origin: { row: 5, col: 5 }, orientation: 'h' };
    expect(() => applyShotResult(hit, record({ row: 5, col: 5 }, { outcome: 'sunk', ship: lying }))).toThrow(/2 cells/);

    const offBoard: PlacedShip = { ...destroyer(), origin: { row: 5, col: BOARD_SIZE - 1 } };
    expect(() =>
      applyShotResult(fresh, record({ row: 5, col: BOARD_SIZE - 1 }, { outcome: 'sunk', ship: offBoard })),
    ).toThrow(/does not fit/);
  });

  it('rejects a sunk ship that would touch a known hit (no-touch rule)', () => {
    // B1 is a known hit. A destroyer reported sunk along A1–A2 would have B1 in
    // its halo — impossible when ships never touch.
    let view = applyShotResult(emptyRemoteView(), { coord: { row: 1, col: 0 }, outcome: 'hit' });
    view = applyShotResult(view, { coord: { row: 0, col: 0 }, outcome: 'hit' });
    const touchingHit: PlacedShip = { spec: spec('destroyer'), origin: { row: 0, col: 0 }, orientation: 'h' };
    expect(() => applyShotResult(view, { coord: { row: 0, col: 1 }, outcome: 'sunk', ship: touchingHit })).toThrow(/touch/);

    // The same ship is fine once nothing around it is a hit.
    let clean = applyShotResult(emptyRemoteView(), { coord: { row: 0, col: 0 }, outcome: 'hit' });
    clean = applyShotResult(clean, { coord: { row: 0, col: 1 }, outcome: 'sunk', ship: touchingHit });
    expect(clean.sunk).toHaveLength(1);
  });

  it('does not mutate the view it is given', () => {
    const before = emptyRemoteView();
    const snapshot = JSON.stringify(before);
    applyShotResult(before, { coord: { row: 2, col: 2 }, outcome: 'miss' });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
