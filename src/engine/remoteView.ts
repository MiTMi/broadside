/**
 * The opponent's board as a shooter is allowed to know it, rebuilt shot by shot
 * from nothing but the results of its own fire (Decision N3). Online, each
 * device is authoritative for its OWN board and answers `shot` with `result`;
 * the shooter folds those results through `applyShotResult` and gets exactly
 * what `toOpponentView` would have produced on the other device — without ever
 * being told where an unsunk ship is.
 *
 * Ordering: `remaining` and `sunk` are kept in FLEET order, which is the order
 * `toOpponentView` produces for any board whose ships were placed longest-first
 * (every board `randomFleet` builds). Sink order is deliberately not used: the
 * shooter cannot know the target's placement order.
 */
import { BOARD_SIZE } from './types';
import type { Coord, OpponentView, PlacedShip, ShipSpec, ShotOutcome, ViewCell } from './types';
import { haloCells, shipCells } from './board';
import { cellKey, coordLabel, inBounds } from './coords';
import { FLEET } from './fleet';

export interface ShotRecord {
  coord: Coord;
  outcome: ShotOutcome;
  /** Present if and only if `outcome === 'sunk'`: the ship that just went down. */
  ship?: PlacedShip;
}

/** Nothing fired, nothing sunk: the whole fleet is still out there somewhere. */
export function emptyRemoteView(): OpponentView {
  const cells: ViewCell[][] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    cells.push(new Array<ViewCell>(BOARD_SIZE).fill('unknown'));
  }
  return { cells, remaining: [...FLEET], sunk: [] };
}

/**
 * Folds one shot result into the view. Throws on anything that cannot have come
 * from an honest target — out of bounds, a cell that is already known, a 'sunk'
 * without its ship, or a ship whose geometry contradicts what is known.
 * Callers that handle peer input must catch (Decision N5).
 */
export function applyShotResult(view: OpponentView, record: ShotRecord): OpponentView {
  const { coord, outcome } = record;
  if (!inBounds(coord)) {
    throw new Error(`applyShotResult: coord out of bounds (${coord.row},${coord.col})`);
  }
  const known = cellAt(view.cells, coord);
  if (known !== 'unknown') {
    throw new Error(`applyShotResult: ${coordLabel(coord)} is already known (${known})`);
  }

  const cells = view.cells.map((row) => [...row]);
  setCell(cells, coord, outcome === 'miss' ? 'miss' : 'hit');

  if (outcome !== 'sunk') return { ...view, cells };

  const ship = normalise(record.ship, view, coord);
  for (const cell of shipCells(ship)) setCell(cells, cell, 'sunk');
  // The no-touch rule makes every cell around a sunk ship provably empty.
  for (const cell of haloCells(ship)) {
    if (cellAt(cells, cell) === 'unknown') setCell(cells, cell, 'clear');
  }

  return {
    cells,
    remaining: view.remaining.filter((spec) => spec.id !== ship.spec.id),
    sunk: [...view.sunk, ship].sort((a, b) => fleetIndex(a.spec) - fleetIndex(b.spec)),
  };
}

/**
 * Checks a reported sunk ship against everything already known and returns it
 * with the canonical FLEET spec, so a peer cannot smuggle in its own ship data.
 */
function normalise(ship: PlacedShip | undefined, view: OpponentView, coord: Coord): PlacedShip {
  if (!ship) throw new Error('applyShotResult: a sunk result must name the ship');

  const spec = FLEET.find((candidate) => candidate.id === ship.spec.id);
  if (!spec) throw new Error(`applyShotResult: unknown ship id ${String(ship.spec.id)}`);
  if (ship.spec.length !== spec.length) {
    throw new Error(`applyShotResult: ${spec.id} is ${spec.length} cells, not ${String(ship.spec.length)}`);
  }
  if (!view.remaining.some((afloat) => afloat.id === spec.id)) {
    throw new Error(`applyShotResult: ${spec.id} has already been sunk`);
  }

  const placed: PlacedShip = { spec, origin: ship.origin, orientation: ship.orientation };
  const cells = shipCells(placed);
  if (!cells.every(inBounds)) {
    throw new Error(`applyShotResult: ${spec.id} does not fit on the board`);
  }
  if (!cells.some((cell) => cellKey(cell) === cellKey(coord))) {
    throw new Error(`applyShotResult: ${coordLabel(coord)} is not part of the ${spec.id}`);
  }
  // Every other cell must already be a hit: a ship sinks on its last cell.
  for (const cell of cells) {
    if (cellKey(cell) === cellKey(coord)) continue;
    if (cellAt(view.cells, cell) !== 'hit') {
      throw new Error(`applyShotResult: ${coordLabel(cell)} is not a known hit on the ${spec.id}`);
    }
  }
  // Ships never touch, so nothing around a sunk ship can be a hit or another
  // ship. Accepting one would paint 'clear' water over a ship that is still
  // afloat, and the shooter could then never finish the game.
  for (const cell of haloCells(placed)) {
    const around = cellAt(view.cells, cell);
    if (around === 'hit' || around === 'sunk') {
      throw new Error(`applyShotResult: the ${spec.id} would touch another ship at ${coordLabel(cell)}`);
    }
  }
  return placed;
}

function cellAt(cells: readonly (readonly ViewCell[])[], c: Coord): ViewCell {
  const cell = cells[c.row]?.[c.col];
  if (!cell) throw new Error(`applyShotResult: coord out of bounds (${c.row},${c.col})`);
  return cell;
}

function setCell(cells: ViewCell[][], c: Coord, value: ViewCell): void {
  const row = cells[c.row];
  if (!row) throw new Error(`applyShotResult: coord out of bounds (${c.row},${c.col})`);
  row[c.col] = value;
}

function fleetIndex(spec: ShipSpec): number {
  return FLEET.findIndex((candidate) => candidate.id === spec.id);
}
