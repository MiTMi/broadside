import type { Board, Coord, Difficulty, GameState, LastShot, Rng, Side } from './types';
import { allSunk, emptyBoard, fire, isClearWater, isFleetComplete, randomFleet } from './board';
import { coordLabel } from './coords';

export function newGame(difficulty: Difficulty): GameState {
  return {
    phase: 'placement',
    turn: 'player',
    winner: null,
    difficulty,
    boards: { player: emptyBoard(), opponent: emptyBoard() },
    stats: { player: { shots: 0, hits: 0 }, opponent: { shots: 0, hits: 0 } },
    lastShot: null,
  };
}

export function startBattle(state: GameState, playerBoard: Board, rng: Rng): GameState {
  if (state.phase !== 'placement') throw new Error(`startBattle: wrong phase (${state.phase})`);
  if (!isFleetComplete(playerBoard)) throw new Error('startBattle: the player fleet is not complete');

  return {
    ...state,
    phase: 'battle',
    turn: 'player',
    winner: null,
    boards: { player: playerBoard, opponent: randomFleet(rng) },
    stats: { player: { shots: 0, hits: 0 }, opponent: { shots: 0, hits: 0 } },
    lastShot: null,
  };
}

export function takeShot(state: GameState, by: Side, c: Coord): GameState {
  if (state.phase !== 'battle') throw new Error(`takeShot: wrong phase (${state.phase})`);
  if (state.turn !== by) throw new Error(`takeShot: it is not ${by}'s turn`);

  const target = other(by);
  const board = state.boards[target];
  if (isClearWater(board, c)) throw new Error(`takeShot: ${coordLabel(c)} is known clear water`);

  const result = fire(board, c);
  const hit = result.outcome !== 'miss';
  const stats = state.stats[by];
  const lastShot: LastShot = { by, coord: c, outcome: result.outcome };
  // Only a sinking shot names a ship: a plain hit tells neither side which ship it struck.
  if (result.outcome === 'sunk' && result.ship) lastShot.ship = result.ship.spec;

  const over = allSunk(result.board);
  return {
    ...state,
    phase: over ? 'over' : 'battle',
    // The winner keeps the turn once the game is over: there is no next turn.
    turn: over ? by : target,
    winner: over ? by : null,
    boards: { ...state.boards, [target]: result.board },
    stats: { ...state.stats, [by]: { shots: stats.shots + 1, hits: stats.hits + (hit ? 1 : 0) } },
    lastShot,
  };
}

export function other(side: Side): Side {
  return side === 'player' ? 'opponent' : 'player';
}
