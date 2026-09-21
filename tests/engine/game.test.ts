import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  emptyBoard,
  isFleetComplete,
  mulberry32,
  newGame,
  other,
  placeShip,
  randomFleet,
  removeShip,
  startBattle,
  takeShot,
  type GameState,
} from '../../src/engine/index';
import { spec } from './helpers';

describe('newGame', () => {
  it('starts in placement with empty boards and zeroed stats', () => {
    const state = newGame('hard');
    expect(state.phase).toBe('placement');
    expect(state.turn).toBe('player');
    expect(state.winner).toBeNull();
    expect(state.difficulty).toBe('hard');
    expect(state.boards.player.ships).toHaveLength(0);
    expect(state.boards.opponent.ships).toHaveLength(0);
    expect(state.stats).toEqual({ player: { shots: 0, hits: 0 }, opponent: { shots: 0, hits: 0 } });
    expect(state.lastShot).toBeNull();
  });
});

describe('startBattle', () => {
  const fleet = randomFleet(mulberry32(3));

  it('gives the opponent a legal fleet and hands the first shot to the player', () => {
    const state = startBattle(newGame('normal'), fleet, mulberry32(9));
    expect(state.phase).toBe('battle');
    expect(state.turn).toBe('player');
    expect(state.boards.player).toBe(fleet);
    expect(isFleetComplete(state.boards.opponent)).toBe(true);
    expect(state.boards.opponent).toEqual(randomFleet(mulberry32(9)));
  });

  it('refuses an incomplete fleet or the wrong phase', () => {
    expect(() => startBattle(newGame('normal'), removeShip(fleet, 'patrol'), mulberry32(1))).toThrow(/not complete/);
    expect(() => startBattle(newGame('normal'), emptyBoard(), mulberry32(1))).toThrow(/not complete/);
    const battling = startBattle(newGame('normal'), fleet, mulberry32(1));
    expect(() => startBattle(battling, fleet, mulberry32(1))).toThrow(/wrong phase/);
  });

  it('leaves the placement state untouched', () => {
    const before = newGame('easy');
    startBattle(before, fleet, mulberry32(1));
    expect(before.phase).toBe('placement');
    expect(before.boards.opponent.ships).toHaveLength(0);
  });
});

/** A two-ship duel, small enough to play to the end by hand. */
function duel(): GameState {
  const playerBoard = placeShip(emptyBoard(), spec('destroyer'), { row: 0, col: 0 }, 'h');
  const opponentBoard = placeShip(emptyBoard(), spec('destroyer'), { row: 5, col: 5 }, 'h');
  return {
    phase: 'battle',
    turn: 'player',
    winner: null,
    difficulty: 'normal',
    boards: { player: playerBoard, opponent: opponentBoard },
    stats: { player: { shots: 0, hits: 0 }, opponent: { shots: 0, hits: 0 } },
    lastShot: null,
  };
}

describe('takeShot', () => {
  it('alternates turns and records stats and the last shot', () => {
    let state = takeShot(duel(), 'player', { row: 11, col: 11 });
    expect(state.turn).toBe('opponent');
    expect(state.stats.player).toEqual({ shots: 1, hits: 0 });
    expect(state.lastShot).toEqual({ by: 'player', coord: { row: 11, col: 11 }, outcome: 'miss' });

    state = takeShot(state, 'opponent', { row: 0, col: 0 });
    expect(state.turn).toBe('player');
    expect(state.stats.opponent).toEqual({ shots: 1, hits: 1 });
    expect(state.lastShot?.outcome).toBe('hit');
    expect(state.lastShot?.ship).toBeUndefined(); // a plain hit names no ship

    state = takeShot(state, 'player', { row: 5, col: 5 });
    expect(state.stats.player).toEqual({ shots: 2, hits: 1 });
    expect(state.boards.opponent.shots[5]?.[5]).toBe('hit');
    expect(state.boards.player.shots[0]?.[0]).toBe('hit');
  });

  it('names the ship on a sinking shot', () => {
    let state = takeShot(duel(), 'player', { row: 5, col: 5 });
    state = takeShot(state, 'opponent', { row: 11, col: 11 });
    state = takeShot(state, 'player', { row: 5, col: 6 });
    expect(state.lastShot?.outcome).toBe('sunk');
    expect(state.lastShot?.ship?.id).toBe('destroyer');
  });

  it('ends the game the instant a fleet is fully sunk', () => {
    let state = takeShot(duel(), 'player', { row: 5, col: 5 });
    expect(state.phase).toBe('battle');
    expect(state.winner).toBeNull();
    state = takeShot(state, 'opponent', { row: 11, col: 11 });
    state = takeShot(state, 'player', { row: 5, col: 6 });
    expect(state.phase).toBe('over');
    expect(state.winner).toBe('player');
    expect(state.turn).toBe('player'); // the winner keeps the turn; there is no next one
    expect(() => takeShot(state, 'opponent', { row: 0, col: 1 })).toThrow(/wrong phase/);
  });

  it('lets the opponent win too', () => {
    let state = takeShot(duel(), 'player', { row: 11, col: 11 });
    state = takeShot(state, 'opponent', { row: 0, col: 0 });
    state = takeShot(state, 'player', { row: 11, col: 10 });
    state = takeShot(state, 'opponent', { row: 0, col: 1 });
    expect(state.winner).toBe('opponent');
    expect(state.phase).toBe('over');
    expect(state.stats.opponent).toEqual({ shots: 2, hits: 2 });
  });

  it('refuses shots out of turn, out of phase, off board or already fired', () => {
    const state = duel();
    expect(() => takeShot(state, 'opponent', { row: 0, col: 0 })).toThrow(/not opponent's turn/);
    expect(() => takeShot({ ...state, phase: 'placement' }, 'player', { row: 0, col: 0 })).toThrow(/wrong phase/);
    expect(() => takeShot(state, 'player', { row: BOARD_SIZE, col: 0 })).toThrow(/out of bounds/);
    const after = takeShot(state, 'player', { row: 11, col: 11 });
    expect(() => takeShot({ ...after, turn: 'player' }, 'player', { row: 11, col: 11 })).toThrow(/already been fired/);
  });

  it('refuses a shot at known clear water', () => {
    // Sink the opponent's destroyer, then aim at its halo.
    let state = takeShot(duel(), 'player', { row: 5, col: 5 });
    state = takeShot(state, 'opponent', { row: 11, col: 11 });
    state = { ...takeShot(state, 'player', { row: 5, col: 6 }), phase: 'battle', turn: 'player', winner: null };
    expect(() => takeShot(state, 'player', { row: 4, col: 5 })).toThrow(/clear water/);
    expect(() => takeShot(state, 'player', { row: 6, col: 7 })).toThrow(/clear water/);
    expect(takeShot(state, 'player', { row: 5, col: 8 }).lastShot?.outcome).toBe('miss'); // outside the halo
  });

  it('leaves the previous state untouched', () => {
    const before = duel();
    takeShot(before, 'player', { row: 5, col: 5 });
    expect(before.boards.opponent.shots[5]?.[5]).toBeNull();
    expect(before.stats.player.shots).toBe(0);
    expect(before.turn).toBe('player');
  });
});

describe('other', () => {
  it('flips sides', () => {
    expect(other('player')).toBe('opponent');
    expect(other('opponent')).toBe('player');
  });
});
