/**
 * Solo vs the computer: the same `GameState` the game has always used, behind
 * the `Match` interface. The rng is passed in and consumed in exactly the order
 * it always was (`startBattle`, then `chooseShot` per CPU turn), so a `?seed=`
 * game plays out identically to before the refactor.
 *
 * The CPU's thinking delay stays in the UI layer: `cpu` is the seam, which also
 * makes this file DOM-free and its tests synchronous.
 */
import {
  coordLabel,
  emptyRemoteView,
  newGame,
  startBattle,
  takeShot,
  toOpponentView,
} from '../engine/index';
import type { Board, Coord, Difficulty, GameState, OpponentView, Rng, Side } from '../engine/index';
import type { Match, MatchMessages, MatchSide, MatchView, SfxEvent } from './match';

/** One CPU turn — structurally the `CpuController` contract of `ui/cpuController.ts`. */
export interface CpuTurnRequest {
  view: OpponentView;
  difficulty: Difficulty;
  rng: Rng;
  fire: (coord: Coord) => void;
}

export interface CpuAdapter {
  take(turn: CpuTurnRequest): void;
  cancel(): void;
}

export interface SoloMatchOptions {
  rng: Rng;
  difficulty: Difficulty;
  cpu: CpuAdapter;
  messages: MatchMessages;
  /** How the log and the copy name the other side. */
  opponentLabel?: string;
}

export function createSoloMatch(options: SoloMatchOptions): Match {
  let game: GameState = newGame(options.difficulty);
  let entries: string[] = [];
  let locked = false;
  let cached: MatchView | null = null;

  const changed: (() => void)[] = [];
  const sfx: ((e: SfxEvent) => void)[] = [];

  function emitChange(): void {
    cached = null;
    for (const cb of changed) cb();
  }

  function play(event: SfxEvent): void {
    for (const cb of sfx) cb(event);
  }

  /** Applies one shot, adds its log lines and plays its cue — in that order. */
  function applyShot(by: Side, coord: Coord): GameState {
    game = takeShot(game, by, coord);
    const shot = game.lastShot;
    if (!shot) return game;
    const side: MatchSide = by === 'player' ? 'me' : 'them';
    const next = [...entries, options.messages.shot(side, coordLabel(shot.coord), shot.outcome)];
    if (shot.outcome === 'sunk' && shot.ship) next.push(options.messages.sunk(side, shot.ship.name));
    entries = next;
    play(shot.outcome === 'miss' ? 'miss' : shot.outcome === 'sunk' ? 'sunk' : 'hit');
    return game;
  }

  function cpuTurn(): void {
    options.cpu.take({
      view: toOpponentView(game.boards.player),
      difficulty: game.difficulty,
      rng: options.rng,
      fire: (target) => {
        if (applyShot('opponent', target).phase === 'over') {
          locked = true;
          emitChange();
          return;
        }
        locked = false;
        emitChange();
      },
    });
  }

  function build(): MatchView {
    const over = game.phase === 'over';
    return {
      mode: 'solo',
      phase: game.phase === 'battle' ? 'battle' : over ? 'over' : 'placement',
      ownBoard: game.boards.player,
      // Before the battle the CPU has no fleet yet: show an untouched view.
      enemyView: game.phase === 'placement' ? emptyRemoteView() : toOpponentView(game.boards.opponent),
      enemyFleetRevealed: over ? game.boards.opponent.ships : null,
      turn: game.turn === 'player' ? 'me' : 'them',
      locked: locked || over,
      winner: game.winner === null ? null : game.winner === 'player' ? 'me' : 'them',
      stats: { me: game.stats.player, them: game.stats.opponent },
      log: entries,
      opponentLabel: options.opponentLabel ?? 'the enemy',
      rematch: 'none',
      verification: 'n/a',
      ended: null,
    };
  }

  return {
    get view(): MatchView {
      if (!cached) cached = build();
      return cached;
    },

    onChange(cb: () => void): void {
      changed.push(cb);
    },

    onSfx(cb: (e: SfxEvent) => void): void {
      sfx.push(cb);
    },

    start(ownBoard: Board): void {
      game = startBattle(game, ownBoard, options.rng);
      entries = [];
      locked = false;
      emitChange();
    },

    fire(coord: Coord): void {
      if (locked || game.phase !== 'battle' || game.turn !== 'player') return;
      if (applyShot('player', coord).phase === 'over') {
        locked = true;
        emitChange();
        return;
      }
      // Locked while the enemy aims: the board must not take a second shot.
      locked = true;
      emitChange();
      cpuTurn();
    },

    /** Solo has no handshake: "Play again" starts a brand-new match. */
    requestRematch(): void {},

    leave(): void {
      options.cpu.cancel();
    },
  };
}
