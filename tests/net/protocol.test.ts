import { describe, expect, it } from 'vitest';
import { BUILD_ID, PROTOCOL_VERSION, helloVersion, parseMsg } from '../../src/net/index';
import type { Msg } from '../../src/net/index';
import { BOARD_SIZE, FLEET, mulberry32, randomFleet } from '../../src/engine/index';

const ship = { spec: { id: 'destroyer', name: 'destroyer', length: 2 }, origin: { row: 5, col: 5 }, orientation: 'h' };

const valid: Msg[] = [
  { t: 'hello', v: 1, build: BUILD_ID },
  { t: 'ready', commit: null },
  { t: 'ready', commit: 'abc123' },
  { t: 'shot', seq: 1, coord: { row: 0, col: 0 } },
  { t: 'result', seq: 2, coord: { row: 11, col: 11 }, outcome: 'miss' },
  { t: 'result', seq: 3, coord: { row: 5, col: 6 }, outcome: 'hit' },
  { t: 'rematch' },
  { t: 'bye', reason: 'left' },
  { t: 'bye', reason: 'full' },
  { t: 'bye', reason: 'version' },
  { t: 'bye', reason: 'error' },
];

describe('parseMsg', () => {
  it('round-trips every message of the protocol through JSON', () => {
    for (const msg of valid) {
      expect(parseMsg(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
    }
  });

  it('accepts a sunk result and rebuilds the ship with the canonical spec', () => {
    const parsed = parseMsg({ t: 'result', seq: 4, coord: { row: 5, col: 6 }, outcome: 'sunk', ship });
    expect(parsed).toEqual({
      t: 'result',
      seq: 4,
      coord: { row: 5, col: 6 },
      outcome: 'sunk',
      ship: { spec: FLEET.find((s) => s.id === 'destroyer'), origin: { row: 5, col: 5 }, orientation: 'h' },
    });
    // The spec is ours, not theirs: a peer cannot rename or resize a ship.
    const lying = parseMsg({
      t: 'result',
      seq: 4,
      coord: { row: 5, col: 6 },
      outcome: 'sunk',
      ship: { ...ship, spec: { id: 'destroyer', name: 'super destroyer', length: 9 } },
    });
    expect(lying).toEqual(parsed);
  });

  it('refuses a ship on anything but a sunk result — that would leak the fleet', () => {
    expect(parseMsg({ t: 'result', seq: 1, coord: { row: 0, col: 0 }, outcome: 'hit', ship })).toBeNull();
    expect(parseMsg({ t: 'result', seq: 1, coord: { row: 0, col: 0 }, outcome: 'miss', ship })).toBeNull();
    expect(parseMsg({ t: 'result', seq: 1, coord: { row: 0, col: 0 }, outcome: 'sunk' })).toBeNull();
  });

  it('accepts a whole revealed fleet and nothing less', () => {
    const fleet = randomFleet(mulberry32(5)).ships;
    const parsed = parseMsg({ t: 'reveal', fleet: JSON.parse(JSON.stringify(fleet)), salt: 'abcd' });
    expect(parsed).toEqual({ t: 'reveal', fleet: [...fleet], salt: 'abcd' });
    expect(parseMsg({ t: 'reveal', fleet: fleet.slice(1), salt: 'abcd' })).toBeNull();
    expect(parseMsg({ t: 'reveal', fleet: [...fleet.slice(1), fleet[0], fleet[0]], salt: 'a' })).toBeNull();
    expect(parseMsg({ t: 'reveal', fleet, salt: '' })).toBeNull();
  });

  it('returns null for anything malformed, and never throws', () => {
    const cycle: Record<string, unknown> = { t: 'shot', seq: 1 };
    cycle['self'] = cycle;

    const junk: unknown[] = [
      null,
      undefined,
      0,
      1,
      'hello',
      true,
      [],
      [{ t: 'shot' }],
      {},
      { t: 'nope' },
      { t: 'hello' },
      { t: 'hello', v: '1', build: 'x' },
      { t: 'hello', v: 2, build: 'x' },
      { t: 'hello', v: 1 },
      { t: 'hello', v: 1, build: '' },
      { t: 'hello', v: 1, build: 'x'.repeat(500) },
      { t: 'ready' },
      { t: 'ready', commit: 3 },
      { t: 'shot', seq: 0, coord: { row: 0, col: 0 } },
      { t: 'shot', seq: 1.5, coord: { row: 0, col: 0 } },
      { t: 'shot', seq: -1, coord: { row: 0, col: 0 } },
      { t: 'shot', seq: Number.NaN, coord: { row: 0, col: 0 } },
      { t: 'shot', seq: 1, coord: { row: BOARD_SIZE, col: 0 } },
      { t: 'shot', seq: 1, coord: { row: -1, col: 0 } },
      { t: 'shot', seq: 1, coord: { row: 0.5, col: 0 } },
      { t: 'shot', seq: 1, coord: { row: '0', col: '0' } },
      { t: 'shot', seq: 1, coord: [0, 0] },
      { t: 'shot', seq: 1 },
      { t: 'result', seq: 1, coord: { row: 0, col: 0 }, outcome: 'destroyed' },
      { t: 'result', seq: 1, coord: { row: 0, col: 0 } },
      { t: 'result', seq: 1, coord: { row: 0, col: 0 }, outcome: 'sunk', ship: { ...ship, spec: { id: 'zeppelin' } } },
      { t: 'result', seq: 1, coord: { row: 0, col: 0 }, outcome: 'sunk', ship: { ...ship, orientation: 'd' } },
      { t: 'result', seq: 1, coord: { row: 0, col: 0 }, outcome: 'sunk', ship: { ...ship, origin: { row: 11, col: 11 } } },
      { t: 'reveal', fleet: 'all of them', salt: 'x' },
      { t: 'reveal', fleet: [], salt: 'x' },
      { t: 'bye' },
      { t: 'bye', reason: 'bored' },
      cycle,
    ];

    for (const raw of junk) {
      expect(() => parseMsg(raw), `parseMsg(${safe(raw)}) must not throw`).not.toThrow();
      expect(parseMsg(raw), `parseMsg(${safe(raw)}) must be null`).toBeNull();
    }
  });

  it('survives a fuzz of mutated messages', () => {
    const rng = mulberry32(42);
    const keys = ['t', 'v', 'seq', 'coord', 'outcome', 'ship', 'fleet', 'salt', 'commit', 'reason', 'build'];
    const values: unknown[] = [null, undefined, 0, -1, 1e9, '', 'x', true, [], {}, { row: 0 }, Number.NaN];

    for (let i = 0; i < 2000; i++) {
      const base = valid[Math.floor(rng() * valid.length)];
      const mutated: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
      const key = keys[Math.floor(rng() * keys.length)] as string;
      mutated[key] = values[Math.floor(rng() * values.length)];
      expect(() => parseMsg(mutated)).not.toThrow();
      const parsed = parseMsg(mutated);
      // Whatever comes back is a message we built ourselves, never the input.
      if (parsed) expect(parsed).not.toBe(mutated);
    }
  });
});

describe('helloVersion', () => {
  it('reads the version a peer claims, so a mismatch can be answered', () => {
    expect(helloVersion({ t: 'hello', v: 2, build: 'x' })).toBe(2);
    expect(helloVersion({ t: 'hello', v: PROTOCOL_VERSION, build: 'x' })).toBe(PROTOCOL_VERSION);
    expect(helloVersion({ t: 'shot', v: 2 })).toBeNull();
    expect(helloVersion({ t: 'hello', v: 'two' })).toBeNull();
    expect(helloVersion(null)).toBeNull();
  });
});

function safe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[circular]';
  }
}
