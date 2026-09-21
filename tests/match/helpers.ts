/**
 * An in-memory transport pair: two `Transport`s wired to each other, delivering
 * only when a test says so. Messages go through JSON on the way, exactly as
 * they would over a data channel, so the two matches can never share an object.
 */
import { expect } from 'vitest';
import { BOARD_SIZE, isSunk } from '../../src/engine/index';
import type { Board, Coord } from '../../src/engine/index';
import type { CloseReason, Msg, Transport, TransportRole } from '../../src/net/index';
import type { MatchView } from '../../src/match/index';

/** Rewrites or drops (null) a message on its way out — for lying-peer tests. */
export type Tamper = (from: TransportRole, msg: Msg) => unknown;

interface Side {
  role: TransportRole;
  transport: Transport;
  message: ((msg: unknown) => void)[];
  open: (() => void)[];
  close: ((why: CloseReason) => void)[];
  closed: boolean;
}

type Item = { to: TransportRole; raw: unknown } | { to: TransportRole; gone: true };

export interface MemoryPair {
  host: Transport;
  guest: Transport;
  /** Both sides learn the peer is there. */
  connect(): void;
  /** Delivers everything pending, including whatever that produces. */
  flush(): void;
  /** Hands a raw value straight to one side, as a hostile peer would. */
  injectTo(role: TransportRole, raw: unknown): void;
  /** That side's connection dies under it. */
  dropAt(role: TransportRole, why: CloseReason): void;
  sent: { from: TransportRole; msg: Msg }[];
}

export function createMemoryPair(tamper?: Tamper): MemoryPair {
  const queue: Item[] = [];
  const sent: { from: TransportRole; msg: Msg }[] = [];
  const sides = new Map<TransportRole, Side>();
  let opened = false;

  const other = (role: TransportRole): TransportRole => (role === 'host' ? 'guest' : 'host');

  function make(role: TransportRole): Side {
    const side: Side = {
      role,
      message: [],
      open: [],
      close: [],
      closed: false,
      transport: {
        role,
        send(msg: Msg): void {
          if (side.closed) return;
          sent.push({ from: role, msg });
          const raw = tamper ? tamper(role, msg) : msg;
          if (raw === null) return;
          queue.push({ to: other(role), raw: JSON.parse(JSON.stringify(raw)) as unknown });
        },
        onMessage(cb): void {
          side.message.push(cb);
        },
        onOpen(cb): void {
          side.open.push(cb);
          if (opened) cb();
        },
        onClose(cb): void {
          side.close.push(cb);
        },
        close(): void {
          if (side.closed) return;
          side.closed = true;
          queue.push({ to: other(role), gone: true });
        },
      },
    };
    return side;
  }

  const host = make('host');
  const guest = make('guest');
  sides.set('host', host);
  sides.set('guest', guest);

  function deliver(item: Item): void {
    const side = sides.get(item.to);
    if (!side || side.closed) return;
    if ('gone' in item) {
      side.closed = true;
      for (const cb of side.close) cb('peer-left');
      return;
    }
    for (const cb of side.message) cb(item.raw);
  }

  return {
    host: host.transport,
    guest: guest.transport,
    sent,

    connect(): void {
      opened = true;
      for (const side of [host, guest]) {
        for (const cb of side.open) cb();
      }
    },

    flush(): void {
      let guard = 0;
      while (queue.length > 0) {
        if (guard++ > 10_000) throw new Error('flush: the two sides will not stop talking');
        const item = queue.shift();
        if (item) deliver(item);
      }
    },

    injectTo(role: TransportRole, raw: unknown): void {
      const side = sides.get(role);
      if (!side || side.closed) return;
      for (const cb of side.message) cb(raw);
    },

    dropAt(role: TransportRole, why: CloseReason): void {
      const side = sides.get(role);
      if (!side || side.closed) return;
      side.closed = true;
      for (const cb of side.close) cb(why);
    },
  };
}

/** The first cell this side is still allowed to fire at. */
export function firstUnknown(cells: readonly (readonly string[])[]): Coord {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (cells[row]?.[col] === 'unknown') return { row, col };
    }
  }
  throw new Error('firstUnknown: nothing left to fire at');
}

/**
 * The heart of the online promise: a view may name a ship of the other fleet
 * only once that ship is genuinely sunk (or the game is over and it was
 * revealed). Checked against the other device's real board.
 */
export function expectNoFleetLeak(view: MatchView, theirBoard: Board, over = false): void {
  for (const ship of view.enemyView.sunk) {
    expect(isSunk(theirBoard, ship), `${ship.spec.id} is shown sunk but is afloat`).toBe(true);
  }

  // Once the game is finished the reveal may name the whole fleet; whether it
  // told the truth is the verification's job, not this one's.
  if (over) return;

  expect(view.enemyFleetRevealed, 'nothing is revealed before the game ends').toBeNull();
  // Positions, not names: knowing which ships are still afloat is fair game
  // (`remaining` is specs only), knowing where they are is not.
  const afloat = theirBoard.ships.filter((ship) => !isSunk(theirBoard, ship));
  const positions = JSON.stringify(view.enemyView.sunk);
  for (const ship of afloat) {
    expect(positions, `${ship.spec.id} is still afloat and must not be placed`).not.toContain(
      `"${ship.spec.id}"`,
    );
  }
}
