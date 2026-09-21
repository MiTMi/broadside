/**
 * Two OnlineMatch instances driven against each other over an in-memory
 * transport pair — the same code two devices would run, with the wire in the
 * middle under the test's control.
 */
import { describe, expect, it } from 'vitest';
import {
  isSunk,
  mulberry32,
  randomFleet,
  shipCells,
  type Board,
  type Coord,
} from '../../src/engine/index';
import { commitFleet, commitPayload, type CommitFn, type Msg, type TransportRole } from '../../src/net/index';
import { MAX_INVALID, createOnlineMatch } from '../../src/match/index';
import type { Match, MatchMessages, SfxEvent } from '../../src/match/index';
import { createMemoryPair, expectNoFleetLeak, firstUnknown, type MemoryPair, type Tamper } from './helpers';

const messages: MatchMessages = {
  shot: (by, label, outcome) => (by === 'me' ? `${label} — ${outcome}.` : `Your opponent fires at ${label} — ${outcome}.`),
  sunk: (by, name) => (by === 'me' ? `You sank their ${name}.` : `They sank your ${name}.`),
};

/**
 * A stand-in digest: deterministic, no WebCrypto, fleet-specific, and short
 * enough to be a plausible hash (the protocol caps text at 128 characters).
 */
const fakeCommit: CommitFn = async (fleet, salt) => {
  const payload = commitPayload(fleet, salt);
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash = Math.imul(hash ^ payload.charCodeAt(i), 0x01000193) >>> 0;
  }
  return `fake-${hash.toString(16)}`;
};

interface Session {
  pair: MemoryPair;
  host: Match;
  guest: Match;
  boards: Record<TransportRole, Board>;
  cues: Record<TransportRole, SfxEvent[]>;
  settle(): Promise<void>;
  sent(from: TransportRole, t: Msg['t']): Msg[];
}

function createSession(
  options: { tamper?: Tamper; seeds?: [number, number]; commit?: CommitFn; hostCommit?: CommitFn } = {},
): Session {
  const pair = createMemoryPair(options.tamper);
  const commit = options.commit ?? fakeCommit;
  const [hostSeed, guestSeed] = options.seeds ?? [21, 22];

  const host = createOnlineMatch({
    transport: pair.host,
    messages,
    commit: options.hostCommit ?? commit,
    salt: () => 'salt-host',
  });
  const guest = createOnlineMatch({ transport: pair.guest, messages, commit, salt: () => 'salt-guest' });
  const cues: Record<TransportRole, SfxEvent[]> = { host: [], guest: [] };
  host.onSfx((e) => cues.host.push(e));
  guest.onSfx((e) => cues.guest.push(e));

  return {
    pair,
    host,
    guest,
    boards: { host: randomFleet(mulberry32(hostSeed)), guest: randomFleet(mulberry32(guestSeed)) },
    cues,
    /** Lets every promise settle and every message land, twice over. */
    async settle(): Promise<void> {
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        pair.flush();
      }
    },
    sent(from: TransportRole, t: Msg['t']): Msg[] {
      return pair.sent.filter((entry) => entry.from === from && entry.msg.t === t).map((entry) => entry.msg);
    },
  };
}

/** Connect, place both fleets, arrive at the first turn. */
async function startBattle(session: Session, order: 'host-first' | 'guest-first' = 'host-first'): Promise<void> {
  session.pair.connect();
  await session.settle();
  if (order === 'host-first') {
    session.host.start(session.boards.host);
    await session.settle();
    session.guest.start(session.boards.guest);
  } else {
    session.guest.start(session.boards.guest);
    await session.settle();
    session.host.start(session.boards.host);
  }
  await session.settle();
}

/** Plays the whole game, one legal shot at a time, checking nothing leaks. */
async function playToTheEnd(session: Session): Promise<void> {
  for (let guard = 0; guard < 400; guard++) {
    const hostView = session.host.view;
    const guestView = session.guest.view;
    if (hostView.phase === 'over' && guestView.phase === 'over') return;

    const shooter =
      hostView.phase === 'battle' && hostView.turn === 'me' && !hostView.locked
        ? ('host' as const)
        : ('guest' as const);
    const match = shooter === 'host' ? session.host : session.guest;
    if (match.view.phase !== 'battle' || match.view.turn !== 'me' || match.view.locked) {
      throw new Error('playToTheEnd: neither side can move');
    }
    match.fire(firstUnknown(match.view.enemyView.cells));
    await session.settle();

    // Checked against the other device's live board: a ship may be named here
    // only if it is really sunk over there.
    expectNoFleetLeak(session.host.view, session.guest.view.ownBoard, session.host.view.phase === 'over');
    expectNoFleetLeak(session.guest.view, session.host.view.ownBoard, session.guest.view.phase === 'over');
  }
  throw new Error('playToTheEnd: the game never ended');
}

const shotsToSink = (board: Board, index: number): Coord[] => {
  const ship = board.ships[index];
  if (!ship) throw new Error('no such ship');
  return shipCells(ship);
};

describe('OnlineMatch — a whole game', () => {
  it('plays to a win, verifies both fleets and never leaks one', async () => {
    const session = createSession();
    await startBattle(session);

    expect(session.host.view.phase).toBe('battle');
    expect(session.guest.view.phase).toBe('battle');
    // The host opens the first game (N7).
    expect(session.host.view.turn).toBe('me');
    expect(session.guest.view.turn).toBe('them');
    expect(session.host.view.verification).toBe('pending');

    await playToTheEnd(session);

    const hostView = session.host.view;
    const guestView = session.guest.view;
    expect(hostView.phase).toBe('over');
    expect(guestView.phase).toBe('over');
    expect([hostView.winner, guestView.winner].sort()).toEqual(['me', 'them']);
    expect(hostView.ended).toBeNull();
    expect(guestView.ended).toBeNull();

    // Each side saw the same battle from its own side.
    expect(hostView.stats.me).toEqual(guestView.stats.them);
    expect(hostView.stats.them).toEqual(guestView.stats.me);
    expect(hostView.ownBoard.ships).toEqual([...session.boards.host.ships]);
    expect(guestView.ownBoard.ships).toEqual([...session.boards.guest.ships]);
    // The loser's board is sunk; the winner still had ships.
    const loser = hostView.winner === 'me' ? guestView : hostView;
    const winner = hostView.winner === 'me' ? hostView : guestView;
    expect(loser.ownBoard.ships.every((ship) => isSunk(loser.ownBoard, ship))).toBe(true);
    expect(winner.enemyView.remaining).toHaveLength(0);

    // Both revealed, both check out (N4).
    expect(hostView.enemyFleetRevealed).toEqual([...session.boards.guest.ships]);
    expect(guestView.enemyFleetRevealed).toEqual([...session.boards.host.ships]);
    expect(hostView.verification).toBe('ok');
    expect(guestView.verification).toBe('ok');

    // One cue per shot, mine and theirs alike (N10).
    expect(session.cues.host).toHaveLength(hostView.stats.me.shots + hostView.stats.them.shots);
    expect(session.cues.host.filter((cue) => cue === 'sunk')).toHaveLength(
      hostView.enemyView.sunk.length + countSunk(hostView.ownBoard),
    );
    expect(hostView.log.length).toBeGreaterThan(10);
  });

  it('works with the real WebCrypto commitment', async () => {
    const session = createSession({ commit: commitFleet });
    await startBattle(session);
    await playToTheEnd(session);
    expect(session.host.view.verification).toBe('ok');
    expect(session.guest.view.verification).toBe('ok');
  });

  it('starts the battle whichever side places first', async () => {
    const session = createSession();
    await startBattle(session, 'guest-first');
    expect(session.host.view.phase).toBe('battle');
    expect(session.guest.view.phase).toBe('battle');
    expect(session.host.view.turn).toBe('me');
  });

  it('waits for the opponent after placing, and says so', async () => {
    const session = createSession();
    session.pair.connect();
    await session.settle();
    expect(session.host.view.phase).toBe('placement');

    session.host.start(session.boards.host);
    await session.settle();
    expect(session.host.view.phase).toBe('waiting-opponent');
    expect(session.host.view.locked).toBe(true);
    expect(session.guest.view.phase).toBe('placement');

    session.guest.start(session.boards.guest);
    await session.settle();
    expect(session.host.view.phase).toBe('battle');
  });

  it('sends hello first, then ready, and nothing before the peer is there', async () => {
    const session = createSession();
    session.host.start(session.boards.host);
    await session.settle();
    expect(session.pair.sent).toEqual([]); // nobody to talk to yet

    session.pair.connect();
    await session.settle();
    expect(session.pair.sent.filter((s) => s.from === 'host').map((s) => s.msg.t)).toEqual(['hello', 'ready']);
  });
});

describe('OnlineMatch — turns and shot numbers', () => {
  it('ignores a shot taken out of turn', async () => {
    const session = createSession();
    await startBattle(session);
    // It is the host's turn: a shot from the peer is not due.
    session.pair.injectTo('host', { t: 'shot', seq: 1, coord: { row: 0, col: 0 } });
    await session.settle();

    expect(session.host.view.ownBoard).toEqual(session.boards.host);
    expect(session.sent('host', 'result')).toEqual([]);
    expect(session.host.view.log).toEqual([]);
  });

  it('ignores a replayed or skipped shot number', async () => {
    const session = createSession();
    await startBattle(session);
    session.host.fire({ row: 0, col: 0 });
    await session.settle();
    expect(session.guest.view.turn).toBe('me');

    const board = session.guest.view.ownBoard;
    // seq 1 has been played; 3 skips a number.
    session.pair.injectTo('guest', { t: 'shot', seq: 1, coord: { row: 5, col: 5 } });
    session.pair.injectTo('guest', { t: 'shot', seq: 3, coord: { row: 6, col: 6 } });
    await session.settle();
    expect(session.guest.view.ownBoard).toEqual(board);
    expect(session.sent('guest', 'result')).toHaveLength(1);
  });

  it('ignores a duplicated result and a result for a shot never taken', async () => {
    const session = createSession();
    await startBattle(session);
    session.host.fire({ row: 0, col: 0 });
    await session.settle();
    const after = session.host.view;

    session.pair.injectTo('host', { t: 'result', seq: 1, coord: { row: 0, col: 0 }, outcome: 'hit' });
    session.pair.injectTo('host', { t: 'result', seq: 2, coord: { row: 1, col: 1 }, outcome: 'miss' });
    await session.settle();
    expect(session.host.view.enemyView).toEqual(after.enemyView);
    expect(session.host.view.stats.me).toEqual(after.stats.me);
  });

  it('ignores a shot at a cell that has already been fired at', async () => {
    const session = createSession();
    await startBattle(session);
    session.host.fire({ row: 0, col: 0 });
    await session.settle();
    session.guest.fire({ row: 0, col: 0 });
    await session.settle();
    const guestBoard = session.guest.view.ownBoard;

    // Same cell again, correctly numbered this time.
    session.pair.injectTo('guest', { t: 'shot', seq: 3, coord: { row: 0, col: 0 } });
    await session.settle();
    expect(session.guest.view.ownBoard).toEqual(guestBoard);
    expect(session.sent('guest', 'result')).toHaveLength(1);
  });

  it('refuses to fire out of turn, twice, or at a cell it already knows', async () => {
    const session = createSession();
    await startBattle(session);

    session.guest.fire({ row: 0, col: 0 }); // not their turn
    await session.settle();
    expect(session.sent('guest', 'shot')).toEqual([]);

    session.host.fire({ row: 0, col: 0 });
    session.host.fire({ row: 1, col: 1 }); // still waiting for the first result
    expect(session.sent('host', 'shot')).toHaveLength(1);
    expect(session.host.view.locked).toBe(true);
    await session.settle();

    session.guest.fire({ row: 3, col: 3 });
    await session.settle();
    session.host.fire({ row: 0, col: 0 }); // already known
    session.host.fire({ row: -1, col: 0 }); // off the board
    await session.settle();
    expect(session.sent('host', 'shot')).toHaveLength(1);
  });
});

describe('OnlineMatch — hostile input', () => {
  it('ends the session after five ignored messages', async () => {
    const session = createSession();
    await startBattle(session);

    for (let i = 0; i < MAX_INVALID - 1; i++) {
      session.pair.injectTo('host', { t: 'nonsense', i });
      expect(session.host.view.ended).toBeNull();
    }
    session.pair.injectTo('host', null);
    await session.settle();

    expect(session.host.view.ended).toBe('error');
    expect(session.host.view.locked).toBe(true);
    expect(session.sent('host', 'bye')).toEqual([{ t: 'bye', reason: 'error' }]);
    // The phase is frozen where it was: the game did not "finish".
    expect(session.host.view.phase).toBe('battle');
    expect(session.host.view.winner).toBeNull();
  });

  it('answers a peer on another protocol version and stops', async () => {
    const session = createSession();
    session.pair.connect();
    await session.settle();

    session.pair.injectTo('host', { t: 'hello', v: 2, build: 'from-the-future' });
    await session.settle();
    expect(session.host.view.ended).toBe('version');
    expect(session.sent('host', 'bye')).toEqual([{ t: 'bye', reason: 'version' }]);
  });

  it('never lets peer input throw, whatever it is', async () => {
    const session = createSession();
    await startBattle(session);
    const junk: unknown[] = [
      undefined,
      'shot',
      42,
      [],
      { t: 'shot', seq: 'one', coord: 'A1' },
      { t: 'result', seq: 1, coord: { row: 0, col: 0 }, outcome: 'sunk' },
      { t: 'reveal', fleet: [], salt: '' },
    ];
    for (const raw of junk) {
      expect(() => session.pair.injectTo('host', raw)).not.toThrow();
    }
  });

  it('ends the session at once when the answer to our shot is impossible — never a silent hang', async () => {
    // The guest answers the very first shot with a "sunk" destroyer whose other
    // cell was never hit. Counting it as one more invalid message would leave
    // the shot pending and both players locked forever.
    let forged = false;
    const tamper: Tamper = (from, msg) => {
      if (from === 'guest' && msg.t === 'result' && !forged) {
        forged = true;
        const origin = msg.coord.col < 11 ? msg.coord : { row: msg.coord.row, col: msg.coord.col - 1 };
        return { ...msg, outcome: 'sunk', ship: { spec: { id: 'destroyer', name: 'destroyer', length: 2 }, origin, orientation: 'h' } };
      }
      return msg;
    };
    const session = createSession({ tamper });
    await startBattle(session);

    session.host.fire(firstUnknown(session.host.view.enemyView.cells));
    await session.settle();

    expect(forged).toBe(true);
    expect(session.host.view.ended).toBe('error');
    expect(session.host.view.locked).toBe(true);
    // The other device is told, so it shows the dialog too instead of waiting.
    expect(session.guest.view.ended).not.toBeNull();
  });

  it('flags a peer whose results contradict the fleet it reveals', async () => {
    // The guest lies once: a miss reported as a hit. The phantom hit never
    // sinks anything, so the game still finishes — and the reveal gives it away.
    let lied = false;
    const tamper: Tamper = (from, msg) => {
      if (from === 'guest' && msg.t === 'result' && msg.outcome === 'miss' && !lied) {
        lied = true;
        return { ...msg, outcome: 'hit' };
      }
      return msg;
    };
    const session = createSession({ tamper });
    await startBattle(session);
    await playToTheEnd(session);

    expect(lied).toBe(true);
    expect(session.host.view.verification).toBe('mismatch');
    // The honest side is still vouched for.
    expect(session.guest.view.verification).toBe('ok');
  });

  it('flags a peer that reveals a different fleet than it committed to', async () => {
    const other = randomFleet(mulberry32(99)).ships;
    const tamper: Tamper = (from, msg) =>
      from === 'guest' && msg.t === 'reveal' ? { ...msg, fleet: other } : msg;
    const session = createSession({ tamper });
    await startBattle(session);
    await playToTheEnd(session);

    expect(session.host.view.verification).toBe('mismatch');
    expect(session.guest.view.verification).toBe('ok');
  });

  it('says nothing about a peer that could not commit', async () => {
    const noCrypto = async (): Promise<string | null> => null;
    const session = createSession({ commit: noCrypto });
    await startBattle(session);
    expect(session.host.view.verification).toBe('n/a');
    await playToTheEnd(session);
    expect(session.host.view.verification).toBe('n/a');
    expect(session.guest.view.verification).toBe('n/a');
  });
});

describe('OnlineMatch — leaving', () => {
  const phases = ['placement', 'waiting-opponent', 'battle', 'over'] as const;

  for (const phase of phases) {
    it(`reports the opponent leaving during ${phase}`, async () => {
      const session = createSession();
      session.pair.connect();
      await session.settle();

      if (phase !== 'placement') {
        session.host.start(session.boards.host);
        await session.settle();
      }
      if (phase === 'battle' || phase === 'over') {
        session.guest.start(session.boards.guest);
        await session.settle();
      }
      if (phase === 'over') await playToTheEnd(session);

      expect(session.host.view.phase).toBe(phase);
      session.guest.leave();
      await session.settle();

      expect(session.host.view.ended).toBe('peer-left');
      expect(session.host.view.phase, 'the phase is frozen, not finished').toBe(phase);
      expect(session.host.view.locked).toBe(true);
    });
  }

  it('reports a connection that drops under us', async () => {
    const session = createSession();
    await startBattle(session);
    session.pair.dropAt('host', 'lost');
    await session.settle();
    expect(session.host.view.ended).toBe('lost');
  });

  it('reports a room that is already full', async () => {
    const session = createSession();
    session.pair.connect();
    await session.settle();
    session.pair.injectTo('guest', { t: 'bye', reason: 'full' });
    await session.settle();
    expect(session.guest.view.ended).toBe('full');
  });

  it('goes quiet once it has ended', async () => {
    const session = createSession();
    await startBattle(session);
    session.pair.dropAt('host', 'lost');
    await session.settle();
    const before = session.pair.sent.length;

    session.host.fire({ row: 0, col: 0 });
    session.host.requestRematch();
    session.pair.injectTo('host', { t: 'shot', seq: 1, coord: { row: 0, col: 0 } });
    await session.settle();
    expect(session.pair.sent).toHaveLength(before);
    expect(session.host.view.ended).toBe('lost');
  });

  it('says goodbye when this side leaves', async () => {
    const session = createSession();
    await startBattle(session);
    session.host.leave();
    await session.settle();
    expect(session.sent('host', 'bye')).toEqual([{ t: 'bye', reason: 'left' }]);
    expect(session.guest.view.ended).toBe('peer-left');
  });
});

describe('OnlineMatch — rematch', () => {
  it('needs both players, and the loser fires first', async () => {
    const session = createSession();
    await startBattle(session);
    await playToTheEnd(session);
    const loser = session.host.view.winner === 'me' ? 'guest' : 'host';
    const loserMatch = loser === 'host' ? session.host : session.guest;
    const winnerMatch = loser === 'host' ? session.guest : session.host;

    winnerMatch.requestRematch();
    await session.settle();
    expect(winnerMatch.view.rematch).toBe('i-asked');
    expect(loserMatch.view.rematch).toBe('they-asked');
    expect(winnerMatch.view.phase).toBe('over');

    loserMatch.requestRematch();
    await session.settle();
    for (const match of [session.host, session.guest]) {
      expect(match.view.phase).toBe('placement');
      expect(match.view.rematch).toBe('none');
      expect(match.view.winner).toBeNull();
      expect(match.view.log).toEqual([]);
      expect(match.view.stats.me).toEqual({ shots: 0, hits: 0 });
      expect(match.view.enemyFleetRevealed).toBeNull();
      expect(match.view.verification).toBe('n/a');
      expect(match.view.ownBoard.ships).toEqual([]);
    }
    // The loser of the last game opens this one (N7).
    expect(loserMatch.view.turn).toBe('me');
    expect(winnerMatch.view.turn).toBe('them');

    // And it really is a new game.
    session.host.start(randomFleet(mulberry32(31)));
    session.guest.start(randomFleet(mulberry32(32)));
    await session.settle();
    expect(loserMatch.view.phase).toBe('battle');
    expect(loserMatch.view.turn).toBe('me');
    expect(winnerMatch.view.locked).toBe(true);
  });

  it('works when the loser asks first', async () => {
    const session = createSession();
    await startBattle(session);
    await playToTheEnd(session);
    const loser = session.host.view.winner === 'me' ? session.guest : session.host;
    const winner = session.host.view.winner === 'me' ? session.host : session.guest;

    loser.requestRematch();
    await session.settle();
    expect(loser.view.rematch).toBe('i-asked');
    expect(winner.view.rematch).toBe('they-asked');

    winner.requestRematch();
    await session.settle();
    expect(loser.view.phase).toBe('placement');
    expect(winner.view.phase).toBe('placement');
    expect(loser.view.turn).toBe('me');
  });

  it('never lets a verdict from the last game land in the rematch', async () => {
    // The host's hash of the guest's reveal is held mid-flight while both
    // players press Play again.
    let release: (() => void) | undefined;
    const hostCommit: CommitFn = async (fleet, salt) => {
      const digest = await fakeCommit(fleet, salt);
      if (salt !== 'salt-guest') return digest; // the host's own commit is prompt
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return digest;
    };

    const session = createSession({ hostCommit });
    await startBattle(session);
    await playToTheEnd(session);
    expect(release, 'the verification is in flight').toBeDefined();
    expect(session.host.view.verification).toBe('pending');

    session.host.requestRematch();
    session.guest.requestRematch();
    await session.settle();
    expect(session.host.view.phase).toBe('placement');
    expect(session.host.view.verification).toBe('n/a');

    release?.();
    await session.settle();
    expect(session.host.view.verification, 'the old verdict is dropped').toBe('n/a');
  });

  it('ignores a rematch before the game is over', async () => {
    const session = createSession();
    await startBattle(session);
    session.host.requestRematch();
    await session.settle();
    expect(session.sent('host', 'rematch')).toEqual([]);
    expect(session.guest.view.rematch).toBe('none');
  });
});

describe('OnlineMatch — what a view may show', () => {
  it('keeps the opponent fleet out of the view until a ship is sunk', async () => {
    const session = createSession();
    await startBattle(session);

    // Sink the guest's first ship, one cell at a time, from the host.
    const cells = shotsToSink(session.boards.guest, 0);
    for (const cell of cells) {
      expectNoFleetLeak(session.host.view, session.guest.view.ownBoard);
      session.host.fire(cell);
      await session.settle();
      if (session.guest.view.turn === 'me') {
        session.guest.fire(firstUnknown(session.guest.view.enemyView.cells));
        await session.settle();
      }
    }

    const view = session.host.view;
    expect(view.enemyView.sunk).toHaveLength(1);
    expect(view.enemyView.sunk[0]?.spec.id).toBe(session.boards.guest.ships[0]?.spec.id);
    expect(view.enemyFleetRevealed).toBeNull();
    expectNoFleetLeak(view, session.guest.view.ownBoard);
    // Clear water appeared around the wreck, exactly as the engine would say.
    expect(view.enemyView.cells.flat().filter((cell) => cell === 'clear').length).toBeGreaterThan(0);
  });
});

function countSunk(board: Board): number {
  return board.ships.filter((ship) => isSunk(board, ship)).length;
}
