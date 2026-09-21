import { BOARD_SIZE } from './types';
import type { Coord, Difficulty, OpponentView, Orientation, Rng } from './types';
import { neighbours4 } from './coords';
import { pick } from './rng';

/** How much more a candidate placement counts when it explains known hits. */
const HIT_WEIGHT = 50;

/**
 * The AI's only input is what an opponent may legitimately know, so it cannot
 * cheat. It is stateless: hunt/target mode is derived from the view each call.
 * The returned coord is always an 'unknown' cell — never 'clear' water, never a
 * cell that has already been fired at.
 */
export function chooseShot(view: OpponentView, difficulty: Difficulty, rng: Rng): Coord {
  const unknown = cellsWith(view, 'unknown');
  if (unknown.length === 0) throw new Error('chooseShot: no cells left to fire at');

  switch (difficulty) {
    case 'easy':
      return easyShot(view, unknown, rng);
    case 'normal':
      return normalShot(view, unknown, rng);
    case 'hard':
      return hardShot(view, unknown, rng);
  }
}

/** Random hunt; after a hit, pokes at random neighbours of it — no line following. */
function easyShot(view: OpponentView, unknown: readonly Coord[], rng: Rng): Coord {
  const around = unknownNeighbours(view, cellsWith(view, 'hit'));
  return pick(rng, around.length > 0 ? around : unknown);
}

/** Parity hunt sized to the smallest remaining ship; target mode follows the line. */
function normalShot(view: OpponentView, unknown: readonly Coord[], rng: Rng): Coord {
  const targeted = lineTarget(view, rng);
  if (targeted) return targeted;

  const around = unknownNeighbours(view, cellsWith(view, 'hit'));
  if (around.length > 0) return pick(rng, around);

  const step = view.remaining.reduce((min, spec) => Math.min(min, spec.length), BOARD_SIZE);
  const buckets: Coord[][] = Array.from({ length: Math.max(step, 1) }, () => []);
  for (const c of unknown) (buckets[(c.row + c.col) % Math.max(step, 1)] as Coord[]).push(c);
  const best = Math.max(...buckets.map((b) => b.length));
  const candidates = buckets.filter((b) => b.length === best);
  return pick(rng, pick(rng, candidates));
}

/**
 * Probability density: every placement of every remaining ship that is still
 * consistent with what we know votes for the cells it covers, with placements
 * explaining known hits weighted far above the rest. Shoot the loudest cell.
 */
function hardShot(view: OpponentView, unknown: readonly Coord[], rng: Rng): Coord {
  const score = densityMap(view);

  let best = 0;
  let bestCells: Coord[] = [];
  for (const c of unknown) {
    const s = score[c.row * BOARD_SIZE + c.col] as number;
    if (s > best) {
      best = s;
      bestCells = [c];
    } else if (s === best && s > 0) {
      bestCells.push(c);
    }
  }

  // No consistent placement covers an un-fired cell (shouldn't happen, but the
  // AI must always produce a legal shot): fall back to the normal heuristics.
  if (bestCells.length === 0) return normalShot(view, unknown, rng);
  return pick(rng, bestCells);
}

function densityMap(view: OpponentView): Float64Array {
  const n = BOARD_SIZE;
  const free = new Uint8Array(n * n); // 1 = a ship could still occupy this cell
  const hit = new Uint8Array(n * n); // 1 = known hit on an unsunk ship
  const hitNbrs = new Uint8Array(n * n); // number of known hits in the 8-nbhd

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const cell = view.cells[row]?.[col];
      const i = row * n + col;
      if (cell === 'unknown') free[i] = 1;
      else if (cell === 'hit') {
        free[i] = 1;
        hit[i] = 1;
      }
    }
  }
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (hit[row * n + col] !== 1) continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const r = row + dr;
          const c = col + dc;
          if (r < 0 || r >= n || c < 0 || c >= n) continue;
          const j = r * n + c;
          hitNbrs[j] = (hitNbrs[j] ?? 0) + 1;
        }
      }
    }
  }

  const counts = new Map<number, number>();
  for (const spec of view.remaining) counts.set(spec.length, (counts.get(spec.length) ?? 0) + 1);

  const score = new Float64Array(n * n);
  for (const [length, multiplicity] of counts) {
    for (const o of ['h', 'v'] as const) {
      const maxRow = o === 'v' ? n - length : n - 1;
      const maxCol = o === 'h' ? n - length : n - 1;
      for (let row = 0; row <= maxRow; row++) {
        for (let col = 0; col <= maxCol; col++) {
          const weight = placementWeight(free, hit, hitNbrs, row, col, length, o);
          if (weight === 0) continue;
          const w = weight * multiplicity;
          const stride = o === 'h' ? 1 : n;
          let i = row * n + col;
          for (let k = 0; k < length; k++, i += stride) {
            if (hit[i] !== 1) score[i] = (score[i] ?? 0) + w;
          }
        }
      }
    }
  }
  return score;
}

/**
 * 0 when the placement is impossible. A placement is impossible if it covers a
 * cell no ship can occupy, or if it touches a known hit it does not cover —
 * under the no-touch rule that hit's ship and this one would be adjacent.
 */
function placementWeight(
  free: Uint8Array,
  hit: Uint8Array,
  hitNbrs: Uint8Array,
  row: number,
  col: number,
  length: number,
  o: Orientation,
): number {
  const n = BOARD_SIZE;
  const stride = o === 'h' ? 1 : n;
  let i = row * n + col;
  let hits = 0;
  let touching = 0; // (cell of placement, adjacent hit) pairs, inside or outside
  let internal = 0; // the same pairs, but with the hit inside the placement
  for (let k = 0; k < length; k++, i += stride) {
    if (free[i] !== 1) return 0;
    touching += hitNbrs[i] as number;
    if (hit[i] === 1) {
      hits += 1;
      internal += (k > 0 ? 1 : 0) + (k < length - 1 ? 1 : 0);
    }
  }
  if (touching > internal) return 0;
  return hits > 0 ? Math.pow(HIT_WEIGHT, hits) : 1;
}

/** Extends the ends of a run of two or more aligned hits. */
function lineTarget(view: OpponentView, rng: Rng): Coord | null {
  const hits = cellsWith(view, 'hit');
  if (hits.length < 2) return null;

  const isHit = (c: Coord): boolean => view.cells[c.row]?.[c.col] === 'hit';
  const isUnknown = (c: Coord): boolean => view.cells[c.row]?.[c.col] === 'unknown';
  const ends: Coord[] = [];

  for (const h of hits) {
    for (const [dr, dc] of [
      [0, 1],
      [1, 0],
    ] as const) {
      const next = { row: h.row + dr, col: h.col + dc };
      if (!isHit(next)) continue; // h..next is a run of >= 2 in this direction
      let back = { row: h.row - dr, col: h.col - dc };
      while (isHit(back)) back = { row: back.row - dr, col: back.col - dc };
      if (isUnknown(back)) ends.push(back);
      let fwd = { row: next.row + dr, col: next.col + dc };
      while (isHit(fwd)) fwd = { row: fwd.row + dr, col: fwd.col + dc };
      if (isUnknown(fwd)) ends.push(fwd);
    }
  }

  return ends.length > 0 ? pick(rng, ends) : null;
}

function cellsWith(view: OpponentView, want: 'unknown' | 'hit'): Coord[] {
  const out: Coord[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (view.cells[row]?.[col] === want) out.push({ row, col });
    }
  }
  return out;
}

/** Every un-fired cell orthogonally adjacent to one of the given cells. */
function unknownNeighbours(view: OpponentView, from: readonly Coord[]): Coord[] {
  const seen = new Set<number>();
  const out: Coord[] = [];
  for (const c of from) {
    for (const n of neighbours4(c)) {
      const k = n.row * BOARD_SIZE + n.col;
      if (seen.has(k)) continue;
      seen.add(k);
      if (view.cells[n.row]?.[n.col] === 'unknown') out.push(n);
    }
  }
  return out;
}
