/**
 * Protocol v1 — the only thing two devices ever say to each other. Pure and
 * DOM-free: every message is a plain JSON object, and every incoming message is
 * rebuilt from scratch by `parseMsg` rather than trusted (Decision N5).
 *
 * Nothing here reveals a fleet: `shot` and `result` carry one coordinate, and a
 * ship rides along only on the result that sinks it (Decision D1 / N3).
 */
import { FLEET, inBounds, shipCells } from '../engine/index';
import type { Coord, PlacedShip, ShotOutcome } from '../engine/index';

export const PROTOCOL_VERSION = 1;

/** Sent in `hello` so a mismatch can be reported with something human. */
export const BUILD_ID = 'broadside-0.1.0';

export type ByeReason = 'left' | 'full' | 'version' | 'error';

export type Msg =
  | { t: 'hello'; v: 1; build: string }
  | { t: 'ready'; commit: string | null }
  | { t: 'shot'; seq: number; coord: Coord }
  | { t: 'result'; seq: number; coord: Coord; outcome: ShotOutcome; ship?: PlacedShip }
  | { t: 'reveal'; fleet: PlacedShip[]; salt: string }
  | { t: 'rematch' }
  | { t: 'bye'; reason: ByeReason };

const OUTCOMES: readonly ShotOutcome[] = ['miss', 'hit', 'sunk'];
const BYE_REASONS: readonly ByeReason[] = ['left', 'full', 'version', 'error'];
/** Long enough for a SHA-256 hex digest and a salt, short enough to bound the work. */
const MAX_TEXT = 128;

/**
 * Validates a raw message and returns a freshly built one, or null. Never
 * throws, whatever the peer sends — including `null`, cycles and hostile shapes.
 */
export function parseMsg(raw: unknown): Msg | null {
  if (!isRecord(raw)) return null;

  switch (raw['t']) {
    case 'hello': {
      if (raw['v'] !== PROTOCOL_VERSION) return null;
      const build = raw['build'];
      if (!isText(build)) return null;
      return { t: 'hello', v: PROTOCOL_VERSION, build };
    }
    case 'ready': {
      const commit = raw['commit'];
      if (commit !== null && !isText(commit)) return null;
      return { t: 'ready', commit };
    }
    case 'shot': {
      const seq = parseSeq(raw['seq']);
      const coord = parseCoord(raw['coord']);
      if (seq === null || coord === null) return null;
      return { t: 'shot', seq, coord };
    }
    case 'result': {
      const seq = parseSeq(raw['seq']);
      const coord = parseCoord(raw['coord']);
      const outcome = raw['outcome'];
      if (seq === null || coord === null || !isOutcome(outcome)) return null;
      const rawShip = raw['ship'];
      // A ship is named by the sinking shot and by nothing else — a plain hit
      // that carried a ship would leak the fleet one cell at a time.
      if (outcome !== 'sunk') {
        return rawShip === undefined || rawShip === null ? { t: 'result', seq, coord, outcome } : null;
      }
      const ship = parseShip(rawShip);
      if (!ship) return null;
      return { t: 'result', seq, coord, outcome, ship };
    }
    case 'reveal': {
      const fleet = parseFleet(raw['fleet']);
      const salt = raw['salt'];
      if (!fleet || !isText(salt)) return null;
      return { t: 'reveal', fleet, salt };
    }
    case 'rematch':
      return { t: 'rematch' };
    case 'bye': {
      const reason = raw['reason'];
      if (!isByeReason(reason)) return null;
      return { t: 'bye', reason };
    }
    default:
      return null;
  }
}

/**
 * The version a raw `hello` claims, whatever it is. `parseMsg` rejects any
 * version but ours, so a mismatch has to be spotted before validation to be
 * answered with the right copy instead of being counted as junk (N5).
 */
export function helloVersion(raw: unknown): number | null {
  if (!isRecord(raw) || raw['t'] !== 'hello') return null;
  const v = raw['v'];
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT;
}

function isOutcome(value: unknown): value is ShotOutcome {
  return typeof value === 'string' && OUTCOMES.includes(value as ShotOutcome);
}

function isByeReason(value: unknown): value is ByeReason {
  return typeof value === 'string' && BYE_REASONS.includes(value as ByeReason);
}

/** Shot numbers are 1, 2, 3… and global across both players. */
function parseSeq(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

function parseCoord(value: unknown): Coord | null {
  if (!isRecord(value)) return null;
  const row = value['row'];
  const col = value['col'];
  if (typeof row !== 'number' || typeof col !== 'number') return null;
  const coord = { row, col };
  return inBounds(coord) ? coord : null;
}

/** A placed ship, rebuilt with the canonical FLEET spec so no peer data rides along. */
function parseShip(value: unknown): PlacedShip | null {
  if (!isRecord(value)) return null;
  const rawSpec = value['spec'];
  if (!isRecord(rawSpec)) return null;
  const spec = FLEET.find((candidate) => candidate.id === rawSpec['id']);
  if (!spec) return null;
  const origin = parseCoord(value['origin']);
  const orientation = value['orientation'];
  if (!origin || (orientation !== 'h' && orientation !== 'v')) return null;
  const ship: PlacedShip = { spec, origin, orientation };
  return shipCells(ship).every(inBounds) ? ship : null;
}

/** The whole fleet, once each. Legality (no touching) is checked by the verifier. */
function parseFleet(value: unknown): PlacedShip[] | null {
  if (!Array.isArray(value) || value.length !== FLEET.length) return null;
  const fleet: PlacedShip[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const ship = parseShip(entry);
    if (!ship || seen.has(ship.spec.id)) return null;
    seen.add(ship.spec.id);
    fleet.push(ship);
  }
  return fleet;
}
