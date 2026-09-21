export const BOARD_SIZE = 12; // never hard-code 10/12 elsewhere; derive from this

export interface Coord {
  row: number;
  col: number;
}

/** h: extends to increasing col; v: increasing row */
export type Orientation = 'h' | 'v';

export type ShipId =
  | 'carrier'
  | 'battleship'
  | 'cruiser'
  | 'submarine'
  | 'frigate'
  | 'destroyer'
  | 'corvette'
  | 'patrol';

export interface ShipSpec {
  id: ShipId;
  name: string;
  length: number;
}

export interface PlacedShip {
  spec: ShipSpec;
  origin: Coord;
  orientation: Orientation;
}

export type ShotMark = null | 'miss' | 'hit';

export interface Board {
  ships: readonly PlacedShip[];
  shots: readonly (readonly ShotMark[])[]; // shots[row][col]
}

export type ShotOutcome = 'miss' | 'hit' | 'sunk';

/** 'clear' = un-fired cell adjacent (8-nbhd) to a sunk ship */
export type ViewCell = 'unknown' | 'miss' | 'hit' | 'sunk' | 'clear';

/** everything an opponent legitimately knows */
export interface OpponentView {
  cells: readonly (readonly ViewCell[])[];
  remaining: readonly ShipSpec[]; // unsunk ship specs
  sunk: readonly PlacedShip[]; // sunk ships are revealed
}

export type Side = 'player' | 'opponent';
export type Phase = 'placement' | 'battle' | 'over';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface SideStats {
  shots: number;
  hits: number;
}

export interface LastShot {
  by: Side;
  coord: Coord;
  outcome: ShotOutcome;
  ship?: ShipSpec;
}

export interface GameState {
  phase: Phase;
  turn: Side;
  winner: Side | null;
  difficulty: Difficulty;
  boards: Record<Side, Board>; // boards[side] = that side's OWN fleet
  stats: Record<Side, SideStats>;
  lastShot: LastShot | null;
}

/** [0,1) */
export type Rng = () => number;
