import { BOARD_SIZE, type Coord } from './types';

const ROW_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function inBounds(c: Coord): boolean {
  return (
    Number.isInteger(c.row) &&
    Number.isInteger(c.col) &&
    c.row >= 0 &&
    c.row < BOARD_SIZE &&
    c.col >= 0 &&
    c.col < BOARD_SIZE
  );
}

/** "D4" = row D (index 3), column 4 (index 3). */
export function coordLabel(c: Coord): string {
  if (!inBounds(c)) throw new Error(`coordLabel: coord out of bounds (${c.row},${c.col})`);
  return `${ROW_LETTERS[c.row] as string}${c.col + 1}`;
}

/** Parses "D4" / "d4". Returns null for anything malformed or off-board. */
export function parseLabel(s: string): Coord | null {
  const m = /^([A-Za-z])(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const row = ROW_LETTERS.indexOf((m[1] as string).toUpperCase());
  const col = Number(m[2]) - 1;
  const coord = { row, col };
  return inBounds(coord) ? coord : null;
}

export function sameCoord(a: Coord, b: Coord): boolean {
  return a.row === b.row && a.col === b.col;
}

/** A cell's index in a flat BOARD_SIZE × BOARD_SIZE grid — handy as a Set key. */
export function cellKey(c: Coord): number {
  return c.row * BOARD_SIZE + c.col;
}

/** The up-to-8 in-bounds neighbours of a cell. */
export function neighbours8(c: Coord): Coord[] {
  const out: Coord[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const n = { row: c.row + dr, col: c.col + dc };
      if (inBounds(n)) out.push(n);
    }
  }
  return out;
}

/** The up-to-4 in-bounds orthogonal neighbours of a cell. */
export function neighbours4(c: Coord): Coord[] {
  const deltas = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;
  const out: Coord[] = [];
  for (const [dr, dc] of deltas) {
    const n = { row: c.row + dr, col: c.col + dc };
    if (inBounds(n)) out.push(n);
  }
  return out;
}
