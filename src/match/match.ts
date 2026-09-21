/**
 * One game, however it is played. `SoloMatch` wraps the engine plus the
 * computer opponent; `OnlineMatch` wraps a `Transport` plus this device's own
 * board and a remote view of the other one. The UI talks to `MatchView` and
 * never to either of them directly (Decision N6), so `app.ts` never grows an
 * `if (online)` branch.
 *
 * Pure and DOM-free: timers, sound and copy come in through the options.
 */
import type { Board, Coord, OpponentView, PlacedShip, ShotOutcome, SideStats } from '../engine/index';

export type MatchMode = 'solo' | 'online';

/** Sides as this device sees them: the engine's player/opponent is not online-safe. */
export type MatchSide = 'me' | 'them';

export type MatchPhase = 'placement' | 'waiting-opponent' | 'battle' | 'over';

/** Where a rematch handshake stands (online only). */
export type RematchState = 'none' | 'i-asked' | 'they-asked';

/** Did the opponent play the fleet it committed to (Decision N4)? */
export type Verification = 'n/a' | 'pending' | 'ok' | 'mismatch';

/**
 * Why an online session stopped, when it was not a finished game: the transport
 * reasons plus the two a peer can announce itself.
 */
export type MatchEnd =
  | 'peer-left'
  | 'lost'
  | 'unreachable'
  | 'timeout'
  | 'full'
  | 'closed'
  | 'version'
  | 'error';

/** The cues a match can ask for. The UI owns what they sound like (`ui/sfx.ts`). */
export type SfxEvent =
  | 'select' // ship picked up in the dock
  | 'place' // ship dropped on the board
  | 'start' // battle begins
  | 'miss'
  | 'hit'
  | 'sunk'
  | 'win'
  | 'lose';

/** Log copy, injected: every user-visible string stays in `ui/copy.ts`. */
export interface MatchMessages {
  shot: (by: MatchSide, label: string, outcome: ShotOutcome) => string;
  sunk: (by: MatchSide, shipName: string) => string;
}

export interface MatchView {
  mode: MatchMode;
  phase: MatchPhase;
  /** My fleet and the shots taken at me. */
  ownBoard: Board;
  /** What I know about the enemy — never more than that (N3). */
  enemyView: OpponentView;
  /** After the game ends (solo: the CPU board; online: from `reveal`). */
  enemyFleetRevealed: readonly PlacedShip[] | null;
  turn: MatchSide;
  locked: boolean;
  winner: MatchSide | null;
  stats: { me: SideStats; them: SideStats };
  log: readonly string[];
  /** "the enemy" (solo) / "your opponent" (online) — a copy hook. */
  opponentLabel: string;
  /** Online only. */
  rematch: RematchState;
  verification: Verification;
  /**
   * Online only: why the session ended, when it was not a finished game — a
   * peer leaving, a dropped connection, a version mismatch. Null while all is
   * well. The phase is frozen where it was, so the UI can say what happened
   * without pretending the game finished.
   */
  ended: MatchEnd | null;
}

export interface Match {
  readonly view: MatchView;
  onChange(cb: () => void): void;
  onSfx(cb: (e: SfxEvent) => void): void;
  /** My fleet is placed: solo starts the battle, online tells the opponent. */
  start(ownBoard: Board): void;
  fire(c: Coord): void;
  requestRematch(): void;
  /** New game, Back, or the tab going away. */
  leave(): void;
}
