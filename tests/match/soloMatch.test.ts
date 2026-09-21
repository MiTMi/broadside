/**
 * SoloMatch must be the game that shipped, moved behind an interface: same rng
 * draws in the same order, same shots, same log, same cues. The first test
 * proves it against a direct engine playthrough written the way `app.ts` used
 * to drive it.
 */
import { describe, expect, it } from 'vitest';
import {
  chooseShot,
  mulberry32,
  newGame,
  randomFleet,
  startBattle,
  takeShot,
  toOpponentView,
  type Coord,
  type Difficulty,
  type GameState,
} from '../../src/engine/index';
import { createSoloMatch } from '../../src/match/index';
import type { CpuAdapter, CpuTurnRequest, Match, MatchMessages, SfxEvent } from '../../src/match/index';
import { firstUnknown } from './helpers';

const messages: MatchMessages = {
  shot: (by, label, outcome) => (by === 'me' ? `${label} — ${outcome}.` : `Enemy fires at ${label} — ${outcome}.`),
  sunk: (by, name) => (by === 'me' ? `You sank the enemy ${name}.` : `The enemy sank your ${name}.`),
};

/** The CPU without its thinking delay — the timer lives in the UI layer. */
function instantCpu(): CpuAdapter {
  let generation = 0;
  return {
    take(turn: CpuTurnRequest): void {
      const mine = ++generation;
      if (mine !== generation) return;
      turn.fire(chooseShot(turn.view, turn.difficulty, turn.rng));
    },
    cancel(): void {
      generation++;
    },
  };
}

/** A CPU that never gets round to firing, so the match stays locked. */
function lazyCpu(): CpuAdapter & { go: () => void } {
  let pending: (() => void) | null = null;
  return {
    take(turn: CpuTurnRequest): void {
      pending = (): void => turn.fire(chooseShot(turn.view, turn.difficulty, turn.rng));
    },
    cancel(): void {
      pending = null;
    },
    go(): void {
      const run = pending;
      pending = null;
      run?.();
    },
  };
}

interface Played {
  match: Match;
  shots: Coord[];
  cues: SfxEvent[];
}

function playMatch(seed: number, difficulty: Difficulty): Played {
  const rng = mulberry32(seed);
  const cpu = instantCpu();
  const match = createSoloMatch({ rng, difficulty, cpu, messages });
  const cues: SfxEvent[] = [];
  match.onSfx((event) => cues.push(event));

  // "Place randomly" draws from the same rng the battle will use.
  match.start(randomFleet(rng));

  const shots: Coord[] = [];
  for (let guard = 0; guard < 300 && match.view.phase === 'battle'; guard++) {
    const coord = firstUnknown(match.view.enemyView.cells);
    shots.push(coord);
    match.fire(coord);
  }
  return { match, shots, cues };
}

/** The same game, driven the way `app.ts` drove the engine before the refactor. */
function playEngine(seed: number, difficulty: Difficulty, shots: readonly Coord[]): GameState {
  const rng = mulberry32(seed);
  const mine = randomFleet(rng);
  let game = startBattle(newGame(difficulty), mine, rng);
  let next = 0;
  while (game.phase === 'battle') {
    if (game.turn === 'player') {
      const coord = shots[next++];
      if (!coord) throw new Error('playEngine: ran out of shots');
      game = takeShot(game, 'player', coord);
    } else {
      game = takeShot(game, 'opponent', chooseShot(toOpponentView(game.boards.player), difficulty, rng));
    }
  }
  return game;
}

describe('createSoloMatch', () => {
  it('plays a seeded game exactly as the engine did before the refactor', () => {
    for (const seed of [1, 4, 7, 12345]) {
      for (const difficulty of ['easy', 'normal', 'hard'] as const) {
        const played = playMatch(seed, difficulty);
        const game = playEngine(seed, difficulty, played.shots);
        const view = played.match.view;

        expect(view.phase, `seed ${seed} ${difficulty}`).toBe('over');
        expect(view.ownBoard).toEqual(game.boards.player);
        expect(view.enemyView).toEqual(toOpponentView(game.boards.opponent));
        expect(view.stats.me).toEqual(game.stats.player);
        expect(view.stats.them).toEqual(game.stats.opponent);
        expect(view.winner).toBe(game.winner === 'player' ? 'me' : 'them');
        expect(view.enemyFleetRevealed).toEqual(game.boards.opponent.ships);
      }
    }
  });

  it('logs and sounds each shot, in the order the game made it', () => {
    const rng = mulberry32(4);
    const cpu = lazyCpu();
    const match = createSoloMatch({ rng, difficulty: 'normal', cpu, messages });
    const cues: SfxEvent[] = [];
    const changes: number[] = [];
    match.onSfx((event) => cues.push(event));
    match.onChange(() => changes.push(cues.length));

    match.start(randomFleet(rng));
    expect(match.view.log).toEqual([]);
    expect(match.view.phase).toBe('battle');
    expect(match.view.turn).toBe('me');

    match.fire({ row: 0, col: 0 });
    // The cue plays before the change is announced, as it always did.
    expect(cues).toHaveLength(1);
    expect(match.view.log).toHaveLength(cues[0] === 'sunk' ? 2 : 1);
    expect(match.view.locked, 'locked while the enemy aims').toBe(true);
    expect(changes.at(-1)).toBe(1);

    cpu.go();
    expect(cues.length).toBeGreaterThan(1);
    expect(match.view.locked).toBe(false);
    expect(match.view.turn).toBe('me');
    expect(match.view.log.length).toBeGreaterThan(1);
  });

  it('ignores a shot that is not the player’s to take', () => {
    const rng = mulberry32(4);
    const cpu = lazyCpu();
    const match = createSoloMatch({ rng, difficulty: 'normal', cpu, messages });

    // Before the battle.
    match.fire({ row: 0, col: 0 });
    expect(match.view.log).toEqual([]);

    match.start(randomFleet(rng));
    match.fire({ row: 0, col: 0 });
    const afterFirst = match.view.log.length;

    // Locked: the enemy has not answered yet.
    match.fire({ row: 0, col: 1 });
    expect(match.view.log).toHaveLength(afterFirst);

    cpu.go();
    match.fire({ row: 0, col: 1 });
    expect(match.view.log.length).toBeGreaterThan(afterFirst);
  });

  it('reports a solo match as a solo match', () => {
    const rng = mulberry32(2);
    const match = createSoloMatch({ rng, difficulty: 'normal', cpu: instantCpu(), messages });
    const view = match.view;
    expect(view.mode).toBe('solo');
    expect(view.phase).toBe('placement');
    expect(view.rematch).toBe('none');
    expect(view.verification).toBe('n/a');
    expect(view.ended).toBeNull();
    expect(view.enemyFleetRevealed).toBeNull();
    expect(view.enemyView.cells.flat().every((cell) => cell === 'unknown')).toBe(true);
    expect(view.opponentLabel).toBe('the enemy');
    // A fresh view once something changes, the same one until then.
    expect(match.view).toBe(view);
    match.start(randomFleet(rng));
    expect(match.view).not.toBe(view);
  });

  it('stops the computer when the player leaves', () => {
    const rng = mulberry32(4);
    const cpu = lazyCpu();
    const match = createSoloMatch({ rng, difficulty: 'normal', cpu, messages });
    match.start(randomFleet(rng));
    match.fire({ row: 0, col: 0 });
    const before = match.view.log.length;

    match.leave();
    cpu.go(); // whatever was in flight is dropped
    expect(match.view.log).toHaveLength(before);
  });
});
