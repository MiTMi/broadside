/**
 * Every user-visible string in the game. Sentence case, plain, specific.
 * Ship names arrive lowercase from the engine ("patrol boat"): they read as-is
 * mid-sentence and are capitalised with `titleCase` when used as a label.
 */
import type { Difficulty, ShotOutcome, Side, ViewCell } from '../engine/index';
import type { MatchEnd, MatchSide } from '../match/index';

export const GAME_TITLE = 'Broadside';

export const COPY = {
  tagline: 'Sink the enemy fleet before it sinks yours.',

  title: {
    solo: 'Play vs computer',
    online: 'Play online',
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

  /** Everything the two-player mode says (Phase 3). */
  online: {
    /** How the log and the battle copy name the other player. */
    opponentLabel: 'your opponent',
    lobbyHeading: 'Play online',
    lobbyIntro: 'One of you creates the game and shares the code. The other joins with it.',
    create: 'Create game',
    joinHeading: 'Join a game',
    codeLabel: 'Room code',
    join: 'Join game',
    /** The shape of a code, in one place: the hint and the example agree. */
    codeExample: 'ABC234',
    invalidCode: 'A room code is 6 letters and numbers, like ABC234.',
    codeHeading: 'Your room code',
    codeHint: 'Send the link, or read the code out to your friend.',
    linkLabel: 'Link to this game',
    copyLink: 'Copy link',
    linkCopied: 'Link copied',
    copyFallback: 'The link is selected — press ⌘C (Ctrl+C) to copy it.',
    share: 'Share',
    shareText: 'Play me at Broadside.',
    back: 'Back',
    backToTitle: 'Back to title',
    waitingForFriend: 'Waiting for your friend to join…',
    joining: (code: string): string => `Joining ${code}…`,
    waitingPlacement: 'Waiting for your opponent to finish placing…',
    opponentTurn: "Opponent's turn…",
    rematchWaiting: 'Waiting for your opponent…',
    theyWantRematch: 'Your opponent wants a rematch.',
    verified: 'Fleet verified',
    mismatch: "Opponent's fleet did not match",
    leave: 'Leave game',
    /** Why an online session stopped, when it was not a finished game (D10). */
    ended: {
      'peer-left': {
        title: 'Your opponent left the game',
        detail: 'There is no one left to play against.',
      },
      lost: {
        title: 'Connection lost',
        detail: 'The link to your opponent dropped. Start a new game to play again.',
      },
      closed: {
        title: 'Connection lost',
        detail: 'The link to your opponent dropped. Start a new game to play again.',
      },
      error: {
        title: 'Connection problem',
        detail: 'Something went wrong on the connection. Start a new game to play again.',
      },
      unreachable: {
        title: "Couldn't reach the connection service",
        detail: 'Check your internet connection.',
      },
      timeout: {
        title: "Couldn't reach that game",
        detail: 'Check the code, or ask your friend to create a new one.',
      },
      full: {
        title: 'That game is already full',
        detail: 'Two players are in that room already.',
      },
      version: {
        title: 'Different versions of the game',
        detail: 'You and your opponent are running different versions. Reload the page and try again.',
      },
    } satisfies Record<MatchEnd, { title: string; detail: string }>,
  },

  confirm: {
    title: 'Start a new game?',
    body: 'This battle will be abandoned and both fleets reset.',
    ok: 'New game',
    cancel: 'Keep playing',
    leaveTitle: 'Leave this game?',
    leaveBody: 'Your opponent will be told that you left, and the game ends for both of you.',
    leaveOk: 'Leave game',
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
    victoryDetailOnline: (shots: number, accuracy: number): string =>
      `Your opponent's fleet sunk in ${shots} shots · ${accuracy}% accuracy`,
    defeatDetailOnline: (shipsLeft: number): string =>
      shipsLeft === 1
        ? 'Your fleet was sunk. Your opponent had 1 ship left.'
        : `Your fleet was sunk. Your opponent had ${shipsLeft} ships left.`,
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

/** "your opponent" → "Your opponent" — the label opens a sentence. */
function opening(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Online: "D4 — hit." / "Your opponent fires at B7 — hit." */
export function onlineShotMessage(by: MatchSide, label: string, outcome: ShotOutcome): string {
  const result = outcome === 'miss' ? 'miss' : 'hit';
  if (by === 'me') return `${label} — ${result}.`;
  return `${opening(COPY.online.opponentLabel)} fires at ${label} — ${result}.`;
}

/** Online: "You sank their cruiser." / "Your opponent sank your destroyer." */
export function onlineSunkMessage(by: MatchSide, shipName: string): string {
  return by === 'me'
    ? `You sank their ${shipName}.`
    : `${opening(COPY.online.opponentLabel)} sank your ${shipName}.`;
}
