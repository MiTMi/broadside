/**
 * The cheap honesty check (Decision N4). At "ready" each side sends
 * `SHA-256(canonical fleet + salt)`; at game over both reveal fleet and salt.
 * The other side then checks two things: that the reveal matches the hash, and
 * that every result it was given during the game is what that fleet would
 * really have produced.
 *
 * This is a friendly-game check, not security: a determined cheat can still
 * cheat. If `crypto.subtle` is missing (a non-secure origin) the commit is
 * `null` and the check is skipped silently, as decided.
 *
 * `crypto` is allowed here and nowhere else in `src/net` besides `roomCode.ts`.
 */
import { FLEET, emptyBoard, fire, isFleetComplete, placeShip, sameCoord } from '../engine/index';
import type { Board, PlacedShip, ShotRecord } from '../engine/index';

/** Injectable so a match can be tested without WebCrypto. */
export type CommitFn = (fleet: readonly PlacedShip[], salt: string) => Promise<string | null>;

/** The exact bytes both sides hash: fleet order can never change the digest. */
export function commitPayload(fleet: readonly PlacedShip[], salt: string): string {
  const ships = [...fleet]
    .sort((a, b) => fleetIndex(a) - fleetIndex(b))
    .map((ship) => `${ship.spec.id}:${ship.origin.row}:${ship.origin.col}:${ship.orientation}`);
  return `${JSON.stringify(ships)}|${salt}`;
}

export const commitFleet: CommitFn = async (fleet, salt) => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const bytes = new TextEncoder().encode(commitPayload(fleet, salt));
    const digest = await subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
};

/** 16 random bytes as hex — enough that a fleet cannot be brute-forced out of the hash. */
export function randomSalt(random: (size: number) => Uint8Array = cryptoBytes): string {
  return [...random(16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Replays every result the peer gave us against the fleet it finally revealed.
 * A peer that called a hit a miss (or sank a ship that was never there) does
 * not survive this.
 */
export function fleetMatchesResults(
  fleet: readonly PlacedShip[],
  records: readonly ShotRecord[],
): boolean {
  let board: Board;
  try {
    board = fleet.reduce(
      (acc, ship) => placeShip(acc, ship.spec, ship.origin, ship.orientation),
      emptyBoard(),
    );
  } catch {
    return false; // an impossible fleet: overlapping, touching or off-board
  }
  if (!isFleetComplete(board)) return false;

  for (const record of records) {
    let result;
    try {
      result = fire(board, record.coord);
    } catch {
      return false; // fired twice at the same cell, or out of bounds
    }
    board = result.board;
    if (result.outcome !== record.outcome) return false;
    if (record.outcome !== 'sunk') continue;
    const claimed = record.ship;
    if (!claimed || !result.ship) return false;
    if (
      claimed.spec.id !== result.ship.spec.id ||
      claimed.orientation !== result.ship.orientation ||
      !sameCoord(claimed.origin, result.ship.origin)
    ) {
      return false;
    }
  }
  return true;
}

function fleetIndex(ship: PlacedShip): number {
  return FLEET.findIndex((spec) => spec.id === ship.spec.id);
}

function cryptoBytes(size: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(size));
}
