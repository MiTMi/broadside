import { BOARD_SIZE } from './types';
import type { Board, Coord, Orientation, PlacedShip, ShipId, ShipSpec, ShotMark, ShotOutcome, Rng } from './types';
import { cellKey, coordLabel, inBounds, neighbours8 } from './coords';
import { FLEET } from './fleet';
import { pick } from './rng';

const MAX_FLEET_ATTEMPTS = 500;

export function emptyBoard(): Board {
  const shots: ShotMark[][] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    shots.push(new Array<ShotMark>(BOARD_SIZE).fill(null));
  }
  return { ships: [], shots };
}

export function shipCells(ship: PlacedShip): Coord[] {
  const cells: Coord[] = [];
  for (let i = 0; i < ship.spec.length; i++) {
    cells.push(
      ship.orientation === 'h'
        ? { row: ship.origin.row, col: ship.origin.col + i }
        : { row: ship.origin.row + i, col: ship.origin.col },
    );
  }
  return cells;
}

/** In-bounds 8-neighbourhood cells of a ship, excluding the ship's own cells. */
export function haloCells(ship: PlacedShip): Coord[] {
  const own = new Set(shipCells(ship).map(cellKey));
  const seen = new Set<number>();
  const out: Coord[] = [];
  for (const cell of shipCells(ship)) {
    for (const n of neighbours8(cell)) {
      const key = cellKey(n);
      if (own.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
  }
  return out;
}

/** In bounds, no overlap, and no touching another ship — not even at a corner. */
export function canPlace(board: Board, spec: ShipSpec, origin: Coord, o: Orientation): boolean {
  const candidate: PlacedShip = { spec, origin, orientation: o };
  const cells = shipCells(candidate);
  if (!cells.every(inBounds)) return false;

  const occupied = occupiedKeys(board);
  for (const cell of cells) {
    if (occupied.has(cellKey(cell))) return false;
    for (const n of neighbours8(cell)) {
      if (occupied.has(cellKey(n))) return false;
    }
  }
  return true;
}

export function placeShip(board: Board, spec: ShipSpec, origin: Coord, o: Orientation): Board {
  if (board.ships.some((s) => s.spec.id === spec.id)) {
    throw new Error(`placeShip: ${spec.id} is already placed`);
  }
  if (!canPlace(board, spec, origin, o)) {
    throw new Error(
      `placeShip: cannot place ${spec.id} at ${origin.row},${origin.col} (${o}) — out of bounds, overlapping or touching another ship`,
    );
  }
  return { ...board, ships: [...board.ships, { spec, origin, orientation: o }] };
}

export function removeShip(board: Board, id: ShipId): Board {
  return { ...board, ships: board.ships.filter((s) => s.spec.id !== id) };
}

export function shipAt(board: Board, c: Coord): PlacedShip | undefined {
  return board.ships.find((ship) => shipCells(ship).some((cell) => cell.row === c.row && cell.col === c.col));
}

export function isFleetComplete(board: Board): boolean {
  if (board.ships.length !== FLEET.length) return false;
  const ids = new Set(board.ships.map((s) => s.spec.id));
  return FLEET.every((spec) => ids.has(spec.id));
}

/**
 * A full, legal fleet placed longest ship first. Each step picks uniformly among
 * every legal placement left; if a ship has none, the whole board restarts.
 */
export function randomFleet(rng: Rng): Board {
  const order = [...FLEET].sort((a, b) => b.length - a.length);

  for (let attempt = 0; attempt < MAX_FLEET_ATTEMPTS; attempt++) {
    let board = emptyBoard();
    let deadEnd = false;

    for (const spec of order) {
      const options: { origin: Coord; o: Orientation }[] = [];
      for (const o of ['h', 'v'] as const) {
        const maxRow = o === 'v' ? BOARD_SIZE - spec.length : BOARD_SIZE - 1;
        const maxCol = o === 'h' ? BOARD_SIZE - spec.length : BOARD_SIZE - 1;
        for (let row = 0; row <= maxRow; row++) {
          for (let col = 0; col <= maxCol; col++) {
            const origin = { row, col };
            if (canPlace(board, spec, origin, o)) options.push({ origin, o });
          }
        }
      }
      if (options.length === 0) {
        deadEnd = true;
        break;
      }
      const choice = pick(rng, options);
      board = placeShip(board, spec, choice.origin, choice.o);
    }

    if (!deadEnd) return board;
  }

  throw new Error(`randomFleet: no legal fleet found after ${MAX_FLEET_ATTEMPTS} attempts`);
}

export function fire(board: Board, c: Coord): { board: Board; outcome: ShotOutcome; ship?: PlacedShip } {
  if (!inBounds(c)) throw new Error(`fire: coord out of bounds (${c.row},${c.col})`);
  if (board.shots[c.row]?.[c.col] != null) throw new Error(`fire: ${coordLabel(c)} has already been fired at`);

  const ship = shipAt(board, c);
  const shots = board.shots.map((r, row) =>
    row === c.row ? r.map((mark, col) => (col === c.col ? (ship ? 'hit' : 'miss') : mark)) : r,
  );
  const next: Board = { ...board, shots };

  if (!ship) return { board: next, outcome: 'miss' };
  return isSunk(next, ship)
    ? { board: next, outcome: 'sunk', ship }
    : { board: next, outcome: 'hit', ship };
}

/** Un-fired and adjacent (8-nbhd) to a sunk ship: provably empty under the no-touch rule. */
export function isClearWater(board: Board, c: Coord): boolean {
  if (!inBounds(c)) return false;
  return clearWaterKeys(board).has(cellKey(c));
}

/**
 * Cell keys of all the clear water on a board — the single source of truth for
 * the rule, shared with `toOpponentView`.
 */
export function clearWaterKeys(board: Board): Set<number> {
  const keys = new Set<number>();
  for (const ship of board.ships) {
    if (!isSunk(board, ship)) continue;
    for (const cell of haloCells(ship)) {
      if (board.shots[cell.row]?.[cell.col] == null) keys.add(cellKey(cell));
    }
  }
  return keys;
}

export function isSunk(board: Board, ship: PlacedShip): boolean {
  return shipCells(ship).every((cell) => board.shots[cell.row]?.[cell.col] === 'hit');
}

export function allSunk(board: Board): boolean {
  return board.ships.length > 0 && board.ships.every((ship) => isSunk(board, ship));
}

function occupiedKeys(board: Board): Set<number> {
  const set = new Set<number>();
  for (const ship of board.ships) {
    for (const cell of shipCells(ship)) set.add(cellKey(cell));
  }
  return set;
}
