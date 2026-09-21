/**
 * The computer opponent as a *controller*, not part of the engine: it waits a
 * beat so the player can read "Enemy is aiming…", then calls `chooseShot` with
 * nothing but the opponent view. `?fast=1` removes the wait for e2e runs.
 */
import { chooseShot } from '../engine/index';
import type { Coord, Difficulty, OpponentView, Rng } from '../engine/index';

const MIN_DELAY = 650;
const MAX_DELAY = 1000;

export interface CpuTurn {
  view: OpponentView;
  difficulty: Difficulty;
  rng: Rng;
  fire: (coord: Coord) => void;
}

export interface CpuController {
  take(turn: CpuTurn): void;
  cancel(): void;
}

export function createCpuController(options: { fast: boolean }): CpuController {
  let timer = 0;
  let generation = 0;

  return {
    take(turn: CpuTurn): void {
      const mine = ++generation;
      // The thinking delay is deliberately NOT drawn from the seeded rng, so a
      // seeded game plays out identically with and without ?fast=1.
      const delay = options.fast ? 0 : MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
      timer = window.setTimeout(() => {
        if (mine !== generation) return;
        turn.fire(chooseShot(turn.view, turn.difficulty, turn.rng));
      }, delay);
    },
    cancel(): void {
      generation++;
      window.clearTimeout(timer);
    },
  };
}
