/**
 * The online session as a state machine over a `Transport` — pure, DOM-free and
 * deterministic. It owns no timer (waiting is the transport's problem) and no
 * randomness beyond the commitment salt; the salt and the hash come in through
 * the options, so two instances can be driven against each other in a unit test
 * with no WebCrypto and no clock.
 *
 * This device is authoritative for its OWN board (Decision N3): it answers the
 * peer's `shot` by running the engine's `fire` on its own fleet, and learns
 * about the peer's board only from the `result`s it gets back. The peer's fleet
 * is never in this module's state before a ship is sunk or the game is over.
 *
 * Nothing the peer sends is trusted (N5): every message is re-parsed, checked
 * against the phase, the turn and the shot number, and ignored if it does not
 * fit. Five ignored messages end the session.
 */
import {
  allSunk,
  applyShotResult,
  coordLabel,
  emptyBoard,
  emptyRemoteView,
  fire,
  sameCoord,
} from '../engine/index';
import type {
  Board,
  Coord,
  OpponentView,
  PlacedShip,
  ShotOutcome,
  ShotRecord,
  SideStats,
} from '../engine/index';
import { PROTOCOL_VERSION, BUILD_ID, helloVersion, parseMsg } from '../net/index';
import type { CommitFn, Msg, Transport } from '../net/index';
import { commitFleet, fleetMatchesResults, randomSalt } from '../net/index';
import type {
  Match,
  MatchEnd,
  MatchMessages,
  MatchPhase,
  MatchSide,
  MatchView,
  RematchState,
  SfxEvent,
  Verification,
} from './match';

/** Ignored peer messages before we give up on the connection (N5). */
export const MAX_INVALID = 5;

export interface OnlineMatchOptions {
  transport: Transport;
  messages: MatchMessages;
  opponentLabel?: string;
  /** Injected in tests; defaults to WebCrypto. */
  commit?: CommitFn;
  salt?: () => string;
  build?: string;
}

export function createOnlineMatch(options: OnlineMatchOptions): Match {
  const { transport, messages } = options;
  const commit: CommitFn = options.commit ?? commitFleet;
  const makeSalt = options.salt ?? ((): string => randomSalt());

  let phase: MatchPhase = 'placement';
  let ownBoard: Board = emptyBoard();
  let enemy: OpponentView = emptyRemoteView();
  let enemyFleetRevealed: readonly PlacedShip[] | null = null;
  /** The host opens the first game; the loser opens every rematch (N7). */
  let firstShooter: MatchSide = transport.role === 'host' ? 'me' : 'them';
  let turn: MatchSide = firstShooter;
  let winner: MatchSide | null = null;
  let rematch: RematchState = 'none';
  let verification: Verification = 'n/a';
  let ended: MatchEnd | null = null;

  let statsMe: SideStats = { shots: 0, hits: 0 };
  let statsThem: SideStats = { shots: 0, hits: 0 };
  let entries: string[] = [];

  let helloSent = false;
  let helloSeen = false;
  let mySalt = '';
  let myCommit: string | null = null;
  let readyReady = false; // my commit is computed and waiting to go out
  let readySent = false;
  let theirReady = false;
  let theirCommit: string | null = null;

  /** 1, 2, 3… across both players. `pending` is my shot waiting for its result. */
  let seq = 0;
  let pending: { seq: number; coord: Coord } | null = null;
  /** Every result I was given, replayed against the reveal at the end (N4). */
  let records: ShotRecord[] = [];
  let invalidCount = 0;
  /** Bumped by a rematch, so an answer from the last game cannot land in this one. */
  let generation = 0;

  let cached: MatchView | null = null;
  const changed: (() => void)[] = [];
  const sfxCbs: ((e: SfxEvent) => void)[] = [];

  function emitChange(): void {
    cached = null;
    for (const cb of changed) cb();
  }

  function play(event: SfxEvent): void {
    for (const cb of sfxCbs) cb(event);
  }

  function send(msg: Msg): void {
    if (ended !== null) return;
    transport.send(msg);
  }

  function log(by: MatchSide, coord: Coord, outcome: ShotOutcome, ship?: PlacedShip): void {
    const next = [...entries, messages.shot(by, coordLabel(coord), outcome)];
    if (outcome === 'sunk' && ship) next.push(messages.sunk(by, ship.spec.name));
    entries = next;
    play(outcome === 'miss' ? 'miss' : outcome === 'sunk' ? 'sunk' : 'hit');
  }

  /** The session is over for a reason that is not a finished game. */
  function end(reason: MatchEnd): void {
    if (ended !== null) return;
    ended = reason;
    pending = null;
    transport.close();
    emitChange();
  }

  function invalid(): void {
    invalidCount += 1;
    if (invalidCount < MAX_INVALID) return;
    fatal();
  }

  /** The two devices can no longer agree on the game: say so and stop, never hang. */
  function fatal(): void {
    send({ t: 'bye', reason: 'error' });
    end('error');
  }

  // --- handshake ---------------------------------------------------------

  function sendHello(): void {
    if (helloSent) return;
    helloSent = true;
    transport.send({ t: 'hello', v: PROTOCOL_VERSION, build: options.build ?? BUILD_ID });
    flushReady();
  }

  /** `ready` waits for both hellos: it is the first message of the game proper. */
  function flushReady(): void {
    if (readySent || !readyReady || !helloSent || !helloSeen || ended !== null) return;
    readySent = true;
    send({ t: 'ready', commit: myCommit });
    startBattleIfReady();
  }

  function startBattleIfReady(): void {
    if (phase !== 'waiting-opponent' || !readySent || !theirReady) return;
    phase = 'battle';
    turn = firstShooter;
    emitChange();
  }

  // --- incoming ----------------------------------------------------------

  function receive(raw: unknown): void {
    if (ended !== null) return;

    // A peer on another protocol cannot be told anything useful — but it can be
    // told why, and that is not the same as junk input (N5).
    const version = helloVersion(raw);
    if (version !== null && version !== PROTOCOL_VERSION) {
      send({ t: 'bye', reason: 'version' });
      end('version');
      return;
    }

    const msg = parseMsg(raw);
    if (!msg) {
      invalid();
      return;
    }
    try {
      handle(msg);
    } catch {
      // Belt and braces: peer input must never throw into the UI loop (N5).
      invalid();
    }
  }

  function handle(msg: Msg): void {
    switch (msg.t) {
      case 'hello':
        if (helloSeen) return invalid();
        helloSeen = true;
        flushReady();
        return;

      case 'ready':
        if (!helloSeen || theirReady) return invalid();
        if (phase !== 'placement' && phase !== 'waiting-opponent') return invalid();
        theirReady = true;
        theirCommit = msg.commit;
        if (theirCommit !== null) verification = 'pending';
        startBattleIfReady();
        emitChange();
        return;

      case 'shot':
        return receiveShot(msg.seq, msg.coord);

      case 'result':
        return receiveResult(msg);

      case 'reveal':
        if (phase !== 'over' || enemyFleetRevealed !== null) return invalid();
        enemyFleetRevealed = msg.fleet;
        void verifyReveal(msg.fleet, msg.salt);
        emitChange();
        return;

      case 'rematch':
        if (phase !== 'over' || rematch === 'they-asked') return invalid();
        if (rematch === 'i-asked') startRematch();
        else {
          rematch = 'they-asked';
          emitChange();
        }
        return;

      case 'bye':
        end(msg.reason === 'left' ? 'peer-left' : msg.reason === 'full' ? 'full' : msg.reason);
        return;

      default:
        return invalid();
    }
  }

  function receiveShot(shotSeq: number, coord: Coord): void {
    if (phase !== 'battle' || turn !== 'them' || shotSeq !== seq + 1) return invalid();
    if (ownBoard.shots[coord.row]?.[coord.col] != null) return invalid();

    seq = shotSeq;
    const result = fire(ownBoard, coord);
    ownBoard = result.board;
    statsThem = {
      shots: statsThem.shots + 1,
      hits: statsThem.hits + (result.outcome === 'miss' ? 0 : 1),
    };
    // Only the sinking shot names a ship — a plain hit tells them nothing (D1).
    const sunkShip = result.outcome === 'sunk' ? result.ship : undefined;
    log('them', coord, result.outcome, sunkShip);
    send({
      t: 'result',
      seq: shotSeq,
      coord,
      outcome: result.outcome,
      ...(sunkShip ? { ship: sunkShip } : {}),
    });

    if (allSunk(ownBoard)) finish('them');
    else turn = 'me';
    emitChange();
  }

  function receiveResult(msg: Extract<Msg, { t: 'result' }>): void {
    const shot = pending;
    if (phase !== 'battle' || !shot || shot.seq !== msg.seq || !sameCoord(shot.coord, msg.coord)) {
      return invalid();
    }

    const record: ShotRecord = {
      coord: msg.coord,
      outcome: msg.outcome,
      ...(msg.outcome === 'sunk' && msg.ship ? { ship: msg.ship } : {}),
    };
    let next: OpponentView;
    try {
      next = applyShotResult(enemy, record);
    } catch {
      // The answer to OUR pending shot cannot be true given what we already
      // know: the peer is broken or lying, and the two boards have diverged.
      // Merely counting it would leave `pending` set and both players locked
      // forever (the protocol is strictly alternating), so end the session.
      return fatal();
    }

    enemy = next;
    pending = null;
    records = [...records, record];
    statsMe = { shots: statsMe.shots + 1, hits: statsMe.hits + (msg.outcome === 'miss' ? 0 : 1) };
    log('me', msg.coord, msg.outcome, record.ship);

    if (enemy.remaining.length === 0) finish('me');
    else turn = 'them';
    emitChange();
  }

  function finish(won: MatchSide): void {
    phase = 'over';
    winner = won;
    turn = won;
    pending = null;
    send({ t: 'reveal', fleet: [...ownBoard.ships], salt: mySalt });
  }

  async function verifyReveal(fleet: readonly PlacedShip[], salt: string): Promise<void> {
    // Hashing takes a turn of the event loop, and a rematch can start in the
    // meantime: a verdict about the last game must not land in the next one.
    const game = generation;
    // Two questions: is this the fleet they committed to, and is it the fleet
    // they actually played?
    if (!fleetMatchesResults(fleet, records)) {
      verification = 'mismatch';
      emitChange();
      return;
    }
    if (theirCommit === null) {
      verification = 'n/a';
      emitChange();
      return;
    }
    const digest = await commit(fleet, salt);
    if (game !== generation) return;
    // A device that cannot hash cannot judge: say nothing rather than accuse.
    verification = digest === null ? 'n/a' : digest === theirCommit ? 'ok' : 'mismatch';
    emitChange();
  }

  function startRematch(): void {
    generation += 1;
    // Roles keep, the loser fires first (N7). Both sides compute the same thing.
    firstShooter = winner === 'me' ? 'them' : 'me';
    phase = 'placement';
    ownBoard = emptyBoard();
    enemy = emptyRemoteView();
    enemyFleetRevealed = null;
    turn = firstShooter;
    winner = null;
    rematch = 'none';
    verification = 'n/a';
    statsMe = { shots: 0, hits: 0 };
    statsThem = { shots: 0, hits: 0 };
    entries = [];
    seq = 0;
    pending = null;
    records = [];
    mySalt = '';
    myCommit = null;
    readyReady = false;
    readySent = false;
    theirReady = false;
    theirCommit = null;
    emitChange();
  }

  // --- view --------------------------------------------------------------

  function build(): MatchView {
    return {
      mode: 'online',
      phase,
      ownBoard,
      enemyView: enemy,
      enemyFleetRevealed,
      turn,
      // Locked means "I cannot fire right now", as it does in solo: waiting for
      // the opponent to place, to shoot, or to answer the shot in flight.
      locked: ended !== null || phase !== 'battle' || turn !== 'me' || pending !== null,
      winner,
      stats: { me: statsMe, them: statsThem },
      log: entries,
      opponentLabel: options.opponentLabel ?? 'your opponent',
      rematch,
      verification,
      ended,
    };
  }

  transport.onMessage(receive);
  transport.onOpen(sendHello);
  transport.onClose((why) => end(why));

  return {
    get view(): MatchView {
      if (!cached) cached = build();
      return cached;
    },

    onChange(cb: () => void): void {
      changed.push(cb);
    },

    onSfx(cb: (e: SfxEvent) => void): void {
      sfxCbs.push(cb);
    },

    /** My fleet is placed. The battle waits for the opponent to say the same. */
    start(board: Board): void {
      if (phase !== 'placement' || ended !== null) return;
      ownBoard = board;
      phase = 'waiting-opponent';
      mySalt = makeSalt();
      emitChange();
      void commit(board.ships, mySalt).then((digest) => {
        myCommit = digest;
        readyReady = true;
        flushReady();
      });
    },

    fire(coord: Coord): void {
      if (ended !== null || phase !== 'battle' || turn !== 'me' || pending !== null) return;
      // Never fire at a cell we already know about — including clear water.
      if (enemy.cells[coord.row]?.[coord.col] !== 'unknown') return;
      seq += 1;
      pending = { seq, coord };
      send({ t: 'shot', seq, coord });
      emitChange();
    },

    requestRematch(): void {
      if (phase !== 'over' || ended !== null || rematch === 'i-asked') return;
      const theyAsked = rematch === 'they-asked';
      send({ t: 'rematch' });
      if (theyAsked) startRematch();
      else {
        rematch = 'i-asked';
        emitChange();
      }
    },

    /**
     * New game, Back, or the tab going away. `ended` becomes 'closed' so that
     * nothing more is sent or acted on — that is this device's own doing, not a
     * disconnect to report back to the player.
     */
    leave(): void {
      if (ended !== null) {
        transport.close();
        return;
      }
      send({ t: 'bye', reason: 'left' });
      ended = 'closed';
      transport.close();
    },
  };
}
