/**
 * Every user-visible string in the game. Sentence case, plain, specific.
 * Ship names arrive lowercase from the engine ("patrol boat"): they read as-is
 * mid-sentence and are capitalised with `titleCase` when used as a label.
 */
import type { Difficulty, ShotOutcome, Side, ViewCell } from '../engine/index';

export const GAME_TITLE = 'Broadside';

export const COPY = {
  tagline: 'Sink the enemy fleet before it sinks yours.',

  title: {
    play: 'Play',
  },

  placement: {
    heading: 'Place your fleet',
    hint: "Pick a ship, then click the board. Press R to rotate. Ships can't touch, not even at corners.",
    hintTouch: "Tap a ship, tap a square to aim, tap again to place. Ships can't touch, not even at corners.",
    rotate: 'Rotate',
    random: 'Place randomly',
    clear: 'Clear board',
    start: 'Start battle',
    difficulty: 'Difficulty',
    remaining: (n: number): string => (n === 1 ? '1 ship left to place' : `${n} ships left to place`),
    ready: 'Fleet ready',
    boardLabel: 'Your waters — place your fleet',
  },

  battle: {
    ownHeading: 'Your fleet',
    enemyHeading: 'Enemy waters',
    yourTurn: 'Your turn — pick a square in enemy waters',
    enemyAiming: 'Enemy is aiming…',
    log: 'Battle log',
    newGame: 'New game',
    ownBoardLabel: 'Your waters',
    enemyBoardLabel: 'Enemy waters',
    enemyFleet: 'Enemy ships',
    yourFleetStatus: 'Your ships',
    soundOn: 'Sound on',
    soundOff: 'Sound off',
  },

  difficulties: {
    easy: 'Easy',
    normal: 'Normal',
    hard: 'Hard',
  } satisfies Record<Difficulty, string>,

  confirm: {
    title: 'Start a new game?',
    body: 'This battle will be abandoned and both fleets reset.',
    ok: 'New game',
    cancel: 'Keep playing',
  },

  over: {
    victory: 'Victory',
    defeat: 'Defeat',
    victoryDetail: (shots: number, accuracy: number): string =>
      `Enemy fleet sunk in ${shots} shots · ${accuracy}% accuracy`,
    defeatDetail: (shipsLeft: number): string =>
      shipsLeft === 1
        ? 'Your fleet was sunk. The enemy had 1 ship left.'
        : `Your fleet was sunk. The enemy had ${shipsLeft} ships left.`,
    playAgain: 'Play again',
    skipVideo: 'Skip',
  },

  board: {
    rowHeader: 'Row',
  },

  fleet: {
    afloat: ', afloat',
    sunk: ', sunk',
  },

  cell: {
    /** What is known about a cell, as a phrase to append to a coordinate. */
    state: {
      unknown: 'not fired',
      miss: 'miss',
      hit: 'hit',
      sunk: 'sunk ship',
      clear: 'clear water',
    } satisfies Record<ViewCell, string>,
    empty: (label: string): string => `${label}, empty`,
    ownShip: (label: string, ship: string): string => `${label}, your ${ship}`,
  },
} as const;

/** "D4, clear water" — the aria-label of a cell on the enemy grid. */
export function cellLabelFor(label: string, state: ViewCell): string {
  return `${label}, ${COPY.cell.state[state]}`;
}

/** "patrol boat" → "Patrol boat". */
export function titleCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** "D4 — hit." / "Enemy fires at B7 — miss." */
export function shotMessage(by: Side, label: string, outcome: ShotOutcome): string {
  const result = outcome === 'miss' ? 'miss' : 'hit';
  return by === 'player' ? `${label} — ${result}.` : `Enemy fires at ${label} — ${result}.`;
}

/** "You sank the enemy cruiser." / "The enemy sank your destroyer." */
export function sunkMessage(by: Side, shipName: string): string {
  return by === 'player'
    ? `You sank the enemy ${shipName}.`
    : `The enemy sank your ${shipName}.`;
}
