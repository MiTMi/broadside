import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, coordLabel, inBounds, neighbours4, neighbours8, parseLabel, sameCoord } from '../../src/engine/index';

describe('coords', () => {
  it('labels 0-based coords as row letter + 1-based column', () => {
    expect(coordLabel({ row: 0, col: 0 })).toBe('A1');
    expect(coordLabel({ row: 3, col: 3 })).toBe('D4');
    expect(coordLabel({ row: BOARD_SIZE - 1, col: BOARD_SIZE - 1 })).toBe('L12');
  });

  it('round-trips every cell through parseLabel', () => {
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const c = { row, col };
        expect(parseLabel(coordLabel(c))).toEqual(c);
      }
    }
  });

  it('parses lower case and rejects malformed or off-board labels', () => {
    expect(parseLabel('d4')).toEqual({ row: 3, col: 3 });
    expect(parseLabel(' B7 ')).toEqual({ row: 1, col: 6 });
    expect(parseLabel('M1')).toBeNull();
    expect(parseLabel('A13')).toBeNull();
    expect(parseLabel('A0')).toBeNull();
    expect(parseLabel('4D')).toBeNull();
    expect(parseLabel('')).toBeNull();
  });

  it('knows the board bounds', () => {
    expect(inBounds({ row: 0, col: 0 })).toBe(true);
    expect(inBounds({ row: BOARD_SIZE - 1, col: BOARD_SIZE - 1 })).toBe(true);
    expect(inBounds({ row: -1, col: 0 })).toBe(false);
    expect(inBounds({ row: 0, col: BOARD_SIZE })).toBe(false);
    expect(inBounds({ row: 1.5, col: 0 })).toBe(false);
  });

  it('clips neighbourhoods to the board', () => {
    expect(neighbours8({ row: 5, col: 5 })).toHaveLength(8);
    expect(neighbours8({ row: 0, col: 0 })).toHaveLength(3);
    expect(neighbours4({ row: 0, col: 0 })).toHaveLength(2);
    expect(neighbours4({ row: 5, col: 5 })).toHaveLength(4);
    expect(sameCoord({ row: 1, col: 2 }, { row: 1, col: 2 })).toBe(true);
    expect(sameCoord({ row: 1, col: 2 }, { row: 2, col: 1 })).toBe(false);
  });

  it('throws when labelling an off-board coord', () => {
    expect(() => coordLabel({ row: BOARD_SIZE, col: 0 })).toThrow();
  });
});
