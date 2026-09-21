import { expect } from 'vitest';
import {
  BOARD_SIZE,
  FLEET,
  cellKey,
  chooseShot,
  fire,
  haloCells,
  inBounds,
  shipCells,
  toOpponentView,
  type Board,
  type Coord,
  type Difficulty,
  type Rng,
  type ShipId,
  type ShipSpec,
} from '../../src/engine/index';

export const key = cellKey;

/** Looks up a fleet spec by id. */
export function spec(id: ShipId): ShipSpec {
  const found = FLEET.find((s) => s.id === id);
  if (!found) throw new Error(`unknown ship id ${id}`);
  return found;
}

/** Asserts a board holds the whole fleet, in bounds, with no two ships touching. */
export function expectLegalFleet(board: Board): void {
  expect(board.ships).toHaveLength(FLEET.length);
  expect(new Set(board.ships.map((s) => s.spec.id)).size).toBe(FLEET.length);

  const owner = new Map<number, string>();
  for (const ship of board.ships) {
    expect(ship.spec.length).toBe(FLEET.find((s) => s.id === ship.spec.id)?.length);
    for (const cell of shipCells(ship)) {
      expect(inBounds(cell)).toBe(true);
      expect(owner.has(key(cell))).toBe(false); // no overlap
      owner.set(key(cell), ship.spec.id);
    }
  }
  for (const ship of board.ships) {
    for (const cell of haloCells(ship)) {
      const neighbourOwner = owner.get(key(cell));
      // Nothing but this ship may sit in its 8-neighbourhood.
      expect(neighbourOwner === undefined || neighbourOwner === ship.spec.id).toBe(true);
    }
  }
}

export interface SoloResult {
  shots: number;
  fired: Coord[];
}

/**
 * Plays one side of a game: the AI fires at `board` until the whole fleet is
 * sunk, asserting every shot lands on a cell the view calls 'unknown' (which
 * covers "never repeats a cell" and "never fires at clear water" at once).
 */
export function playSolo(board: Board, difficulty: Difficulty, rng: Rng): SoloResult {
  let current = board;
  const fired: Coord[] = [];
  let remaining = current.ships.length;

  for (let guard = 0; guard <= BOARD_SIZE * BOARD_SIZE; guard++) {
    const view = toOpponentView(current);
    if (view.remaining.length === 0) return { shots: fired.length, fired };

    const shot = chooseShot(view, difficulty, rng);
    expect(inBounds(shot)).toBe(true);
    expect(view.cells[shot.row]?.[shot.col]).toBe('unknown');

    const result = fire(current, shot);
    current = result.board;
    fired.push(shot);
    if (result.outcome === 'sunk') remaining -= 1;
  }

  throw new Error(`playSolo: ${difficulty} AI did not finish (${remaining} ships left)`);
}
