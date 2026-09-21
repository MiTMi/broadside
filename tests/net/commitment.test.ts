import { describe, expect, it } from 'vitest';
import { commitFleet, commitPayload, fleetMatchesResults, randomSalt } from '../../src/net/index';
import {
  emptyBoard,
  fire,
  mulberry32,
  placeShip,
  randomFleet,
  type Board,
  type Coord,
  type PlacedShip,
  type ShotRecord,
} from '../../src/engine/index';
import { spec } from '../engine/helpers';

const fleetOf = (seed: number): readonly PlacedShip[] => randomFleet(mulberry32(seed)).ships;

/** Shoots a whole board and keeps what an honest target would have replied. */
function honestRecords(fleet: readonly PlacedShip[], shots: readonly Coord[]): ShotRecord[] {
  let board: Board = fleet.reduce<Board>(
    (acc, ship) => placeShip(acc, ship.spec, ship.origin, ship.orientation),
    emptyBoard(),
  );
  const records: ShotRecord[] = [];
  for (const coord of shots) {
    const result = fire(board, coord);
    board = result.board;
    records.push({
      coord,
      outcome: result.outcome,
      ...(result.outcome === 'sunk' && result.ship ? { ship: result.ship } : {}),
    });
  }
  return records;
}

/** Every cell of the first ship, then a couple of empty ones. */
function shotsAt(fleet: readonly PlacedShip[]): Coord[] {
  const first = fleet[0];
  if (!first) throw new Error('no fleet');
  const cells: Coord[] = [];
  for (let i = 0; i < first.spec.length; i++) {
    cells.push(
      first.orientation === 'h'
        ? { row: first.origin.row, col: first.origin.col + i }
        : { row: first.origin.row + i, col: first.origin.col },
    );
  }
  return cells;
}

describe('commitPayload', () => {
  it('does not depend on the order ships were placed in', () => {
    const fleet = fleetOf(9);
    expect(commitPayload([...fleet].reverse(), 'salt')).toBe(commitPayload(fleet, 'salt'));
  });

  it('changes when the fleet or the salt changes', () => {
    expect(commitPayload(fleetOf(9), 'a')).not.toBe(commitPayload(fleetOf(9), 'b'));
    expect(commitPayload(fleetOf(9), 'a')).not.toBe(commitPayload(fleetOf(10), 'a'));
  });
});

describe('commitFleet', () => {
  it('is a stable SHA-256 hex digest', async () => {
    const fleet = fleetOf(9);
    const salt = 'cafebabe';
    const digest = await commitFleet(fleet, salt);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await commitFleet([...fleet].reverse(), salt)).toBe(digest);
    expect(await commitFleet(fleetOf(10), salt)).not.toBe(digest);
    expect(await commitFleet(fleet, 'other')).not.toBe(digest);
  });

  it('hides the fleet: the salt is long and random', () => {
    const salt = randomSalt();
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(randomSalt()).not.toBe(salt);
  });
});

describe('fleetMatchesResults', () => {
  const fleet = fleetOf(9);
  const shots = shotsAt(fleet);

  it('accepts the fleet that really produced the results', () => {
    expect(fleetMatchesResults(fleet, honestRecords(fleet, shots))).toBe(true);
    expect(fleetMatchesResults(fleet, [])).toBe(true);
  });

  it('catches a peer that called a hit a miss', () => {
    const records = honestRecords(fleet, shots);
    const first = records[0];
    if (!first) throw new Error('no records');
    expect(fleetMatchesResults(fleet, [{ coord: first.coord, outcome: 'miss' }])).toBe(false);
  });

  it('catches a peer that sank a ship that was never there', () => {
    const lying: ShotRecord = {
      coord: { row: 0, col: 0 },
      outcome: 'sunk',
      ship: { spec: spec('patrol'), origin: { row: 0, col: 0 }, orientation: 'h' },
    };
    expect(fleetMatchesResults(fleet, [lying])).toBe(false);
  });

  it('catches a reveal that is not the fleet that was played', () => {
    expect(fleetMatchesResults(fleetOf(10), honestRecords(fleet, shots))).toBe(false);
  });

  it('refuses an impossible fleet', () => {
    const touching: PlacedShip[] = [
      { spec: spec('carrier'), origin: { row: 0, col: 0 }, orientation: 'h' },
      { spec: spec('battleship'), origin: { row: 1, col: 0 }, orientation: 'h' },
    ];
    expect(fleetMatchesResults(touching, [])).toBe(false);
    expect(fleetMatchesResults([], [])).toBe(false); // not a complete fleet
    expect(fleetMatchesResults(fleet.slice(1), [])).toBe(false);
  });

  it('refuses a replay that fires twice at the same cell', () => {
    const records = honestRecords(fleet, shots);
    const first = records[0];
    if (!first) throw new Error('no records');
    expect(fleetMatchesResults(fleet, [first, first])).toBe(false);
  });
});
