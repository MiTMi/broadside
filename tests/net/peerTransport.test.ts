/**
 * The PeerJS transport against a fake `peerjs` module: every test here is one
 * process, no broker, no WebRTC, no network of any kind. The fake implements
 * only what the transport is allowed to use (`on`, `connect`, `reconnect`,
 * `destroy`, `send`, `close`, `open`, `destroyed`), so a test that passes is
 * also a statement about how small the surface is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Msg } from '../../src/net/index';

const { FakePeer, made } = vi.hoisted(() => {
  type Handler = (...args: never[]) => void;

  class Emitter {
    private readonly handlers = new Map<string, Handler[]>();

    on(event: string, cb: Handler): this {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const cb of [...(this.handlers.get(event) ?? [])]) {
        (cb as (...a: unknown[]) => void)(...args);
      }
    }
  }

  class FakeConn extends Emitter {
    open = false;
    readonly sent: unknown[] = [];
    readonly closes: ({ flush?: boolean } | undefined)[] = [];

    constructor(
      readonly target: string,
      readonly options: Record<string, unknown>,
    ) {
      super();
    }

    send(data: unknown): void {
      if (!this.open) throw new Error('not open yet');
      this.sent.push(data);
    }

    close(options?: { flush?: boolean }): void {
      this.closes.push(options);
    }

    /** The peer on the other end answered. */
    goOpen(): void {
      this.open = true;
      this.emit('open');
    }
  }

  const made: FakePeer[] = [];

  class FakePeer extends Emitter {
    destroyed = false;
    destroys = 0;
    reconnects = 0;
    /** Set by a test to make `connect` behave like a dead socket. */
    refuseConnect = false;
    readonly outgoing: FakeConn[] = [];

    constructor(readonly id?: string) {
      super();
      made.push(this);
    }

    connect(target: string, options: Record<string, unknown> = {}): FakeConn | undefined {
      if (this.refuseConnect) return undefined;
      const conn = new FakeConn(target, options);
      this.outgoing.push(conn);
      return conn;
    }

    reconnect(): void {
      this.reconnects += 1;
    }

    destroy(): void {
      this.destroys += 1;
      this.destroyed = true;
    }

    /** A connection knocking on this host. */
    incoming(): FakeConn {
      const conn = new FakeConn(this.id ?? '', {});
      this.emit('connection', conn);
      return conn;
    }
  }

  return { FakePeer, FakeConn, made };
});

vi.mock('peerjs', () => ({ Peer: FakePeer as unknown as typeof import('peerjs').Peer }));

import { createPeerTransport, createTransport, roomCodeTaken } from '../../src/net/index';
import { BROKER_TIMEOUT_MS, FLUSH_GRACE_MS, JOIN_TIMEOUT_MS } from '../../src/net/peerTransport';
import type { CloseReason, Transport } from '../../src/net/index';

type Box = {
  transport: Transport;
  seen: unknown[];
  opened: number;
  closed: CloseReason[];
};

const hello: Msg = { t: 'hello', v: 1, build: 'test' };
const shot: Msg = { t: 'shot', seq: 1, coord: { row: 2, col: 3 } };

/** Lets the dynamic `import('peerjs')` and every pending microtask land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(0);
}

function make(role: 'host' | 'guest', code: string): Box {
  const transport = createPeerTransport(role, code);
  const box: Box = { transport, seen: [], opened: 0, closed: [] };
  transport.onMessage((msg) => box.seen.push(msg));
  transport.onOpen(() => {
    box.opened += 1;
  });
  transport.onClose((why) => box.closed.push(why));
  return box;
}

/** The single peer the transport under test built. */
function peer(): InstanceType<typeof FakePeer> {
  const last = made[made.length - 1];
  if (!last) throw new Error('no Peer was constructed');
  return last;
}

beforeEach(() => {
  vi.useFakeTimers();
  made.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PeerTransport — host', () => {
  it('registers the room code as its broker id and opens on the first guest', async () => {
    const host = make('host', 'ABC234');
    expect(made).toHaveLength(0); // nothing is built before PeerJS has loaded
    await settle();

    expect(peer().id).toBe('broadside-ABC234');
    expect(host.opened).toBe(0);

    const guest = peer().incoming();
    guest.goOpen();
    expect(host.opened).toBe(1);
    expect(host.transport.role).toBe('host');
  });

  it('keeps waiting when a guest never gets its channel open', async () => {
    const host = make('host', 'ABC234');
    await settle();

    const failed = peer().incoming();
    failed.emit('close');
    expect(host.closed).toEqual([]);
    expect(host.opened).toBe(0);

    const real = peer().incoming();
    real.goOpen();
    expect(host.opened).toBe(1);
  });

  it('turns a second guest away with bye/full and plays on with the first', async () => {
    const host = make('host', 'ABC234');
    await settle();
    const first = peer().incoming();
    first.goOpen();

    const second = peer().incoming();
    second.goOpen();

    expect(second.sent).toEqual([{ t: 'bye', reason: 'full' }]);
    expect(second.closes).toEqual([{ flush: true }]);
    // The game in progress does not notice.
    expect(host.closed).toEqual([]);
    expect(host.opened).toBe(1);
    host.transport.send(shot);
    expect(first.sent).toEqual([shot]);
    first.emit('data', hello);
    expect(host.seen).toEqual([hello]);
  });

  it('reports a taken room code as unreachable, and says so to the caller', async () => {
    const host = make('host', 'ABC234');
    await settle();

    peer().emit('error', { type: 'unavailable-id' });
    expect(host.closed).toEqual(['unreachable']);
    expect(roomCodeTaken(host.transport)).toBe(true);
    expect(peer().destroys).toBe(1);
  });

  it('gives up on a broker that never opens the peer', async () => {
    const host = make('host', 'ABC234');
    await settle();

    await vi.advanceTimersByTimeAsync(BROKER_TIMEOUT_MS);
    expect(host.closed).toEqual(['unreachable']);
    expect(roomCodeTaken(host.transport)).toBe(false);
    expect(peer().destroys).toBe(1);
  });

  it('waits for a guest as long as it takes once the broker has answered', async () => {
    const host = make('host', 'ABC234');
    await settle();
    peer().emit('open', 'broadside-ABC234');

    await vi.advanceTimersByTimeAsync(BROKER_TIMEOUT_MS * 3);
    expect(host.closed).toEqual([]);
  });
});

describe('PeerTransport — guest', () => {
  it('connects to the host id over a reliable, ordered, JSON channel', async () => {
    const guest = make('guest', 'ABC234');
    await settle();

    expect(peer().id).toBeUndefined(); // the broker names the guest
    peer().emit('open', 'some-random-id');

    const conn = peer().outgoing[0];
    expect(conn?.target).toBe('broadside-ABC234');
    expect(conn?.options).toEqual({ reliable: true, serialization: 'json' });
    expect(guest.opened).toBe(0);

    conn?.goOpen();
    expect(guest.opened).toBe(1);
  });

  it('gives up after twenty seconds', async () => {
    const guest = make('guest', 'ABC234');
    await settle();
    peer().emit('open', 'some-random-id');

    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS - 1);
    expect(guest.closed).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(guest.closed).toEqual(['timeout']);
    expect(peer().destroys).toBe(1);
  });

  it('reads "no such room" as a game it could not reach', async () => {
    const guest = make('guest', 'ABC234');
    await settle();
    peer().emit('open', 'some-random-id');
    peer().emit('error', { type: 'peer-unavailable' });

    expect(guest.closed).toEqual(['timeout']);
  });

  it('reads a channel that dies before it opens the same way', async () => {
    const guest = make('guest', 'ABC234');
    await settle();
    peer().emit('open', 'some-random-id');
    peer().outgoing[0]?.emit('close');

    expect(guest.closed).toEqual(['timeout']);
  });

  it('survives a broker that hands back no connection at all', async () => {
    const guest = make('guest', 'ABC234');
    await settle();
    peer().refuseConnect = true;
    peer().emit('open', 'some-random-id');

    expect(guest.closed).toEqual([]); // the error event or the deadline reports it
    peer().emit('error', { type: 'disconnected' });
    expect(guest.closed).toEqual([]);
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS);
    expect(guest.closed).toEqual(['timeout']);
  });

  it.each([
    'network',
    'server-error',
    'socket-error',
    'socket-closed',
    'ssl-unavailable',
    'invalid-key',
    'invalid-id',
    'browser-incompatible',
    'webrtc',
  ])('reports a %s error as unreachable', async (type) => {
    const guest = make('guest', 'ABC234');
    await settle();
    peer().emit('error', { type });

    expect(guest.closed).toEqual(['unreachable']);
  });

  it('gives a dropped broker socket one chance to come back', async () => {
    const guest = make('guest', 'ABC234');
    await settle();
    peer().emit('disconnected', 'some-random-id');

    expect(peer().reconnects).toBe(1);
    expect(guest.closed).toEqual([]);
  });

});

describe('PeerTransport — messages', () => {
  it('delivers what was sent before the channel opened, in order and before onOpen', async () => {
    const guest = make('guest', 'ABC234');
    guest.transport.send(hello);
    await settle();
    guest.transport.send(shot);
    peer().emit('open', 'some-random-id');
    const conn = peer().outgoing[0];
    expect(conn?.sent).toEqual([]);

    let sentWhenOpenFired = -1;
    guest.transport.onOpen(() => {
      sentWhenOpenFired = conn?.sent.length ?? -1;
    });
    conn?.goOpen();

    expect(conn?.sent).toEqual([hello, shot]);
    expect(guest.opened).toBe(1);
    // The match's own `hello` must follow the queue, not jump it.
    expect(sentWhenOpenFired).toBe(2);
  });

  it('passes incoming data on raw, whatever it is', async () => {
    const guest = make('guest', 'ABC234');
    await settle();
    peer().emit('open', 'some-random-id');
    const conn = peer().outgoing[0];
    conn?.goOpen();

    conn?.emit('data', hello);
    conn?.emit('data', 'not a message at all');
    conn?.emit('data', null);

    expect(guest.seen).toEqual([hello, 'not a message at all', null]);
  });

  it('calls a late onOpen straight away, and never after a close', async () => {
    const guest = make('guest', 'ABC234');
    await settle();
    peer().emit('open', 'some-random-id');
    peer().outgoing[0]?.goOpen();

    let late = 0;
    guest.transport.onOpen(() => {
      late += 1;
    });
    expect(late).toBe(1);

    guest.transport.close();
    guest.transport.onOpen(() => {
      late += 1;
    });
    expect(late).toBe(1);
  });
});

describe('PeerTransport — losing the connection', () => {
  it('reports a channel that closes mid-game as lost', async () => {
    const guest = make('guest', 'ABC234');
    await settle();
    peer().emit('open', 'some-random-id');
    const conn = peer().outgoing[0];
    conn?.goOpen();

    conn?.emit('close');
    expect(guest.closed).toEqual(['lost']);
    expect(peer().destroys).toBe(1);
  });

  it('delivers a deliberate goodbye before the close it rides ahead of', async () => {
    const guest = make('guest', 'ABC234');
    const order: string[] = [];
    guest.transport.onMessage((msg) => order.push(`msg:${JSON.stringify(msg)}`));
    guest.transport.onClose((why) => order.push(`close:${why}`));
    await settle();
    peer().emit('open', 'some-random-id');
    const conn = peer().outgoing[0];
    conn?.goOpen();

    conn?.emit('data', { t: 'bye', reason: 'left' });
    conn?.emit('close');

    expect(order).toEqual(['msg:{"t":"bye","reason":"left"}', 'close:lost']);
  });

  it('reports a failed negotiation as lost and ignores a failed send', async () => {
    const guest = make('guest', 'ABC234');
    await settle();
    peer().emit('open', 'some-random-id');
    const conn = peer().outgoing[0];
    conn?.goOpen();

    conn?.emit('error', { type: 'not-open-yet' });
    conn?.emit('error', { type: 'message-too-big' });
    expect(guest.closed).toEqual([]);

    conn?.emit('error', { type: 'negotiation-failed' });
    expect(guest.closed).toEqual(['lost']);
  });

  it('ignores broker trouble once the players are talking', async () => {
    const guest = make('guest', 'ABC234');
    await settle();
    peer().emit('open', 'some-random-id');
    const conn = peer().outgoing[0];
    conn?.goOpen();

    peer().emit('disconnected', 'some-random-id');
    peer().emit('error', { type: 'network' });
    peer().emit('error', { type: 'unavailable-id' });
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS * 2);

    expect(guest.closed).toEqual([]);
    expect(peer().reconnects).toBe(0); // a live channel needs no broker
    guest.transport.send(shot);
    expect(conn?.sent).toEqual([shot]);
  });

  it('says nothing more once it has reported a close', async () => {
    const guest = make('guest', 'ABC234');
    await settle();
    peer().emit('open', 'some-random-id');
    const conn = peer().outgoing[0];
    conn?.goOpen();

    conn?.emit('close');
    conn?.emit('close');
    conn?.emit('error', { type: 'negotiation-failed' });
    peer().emit('error', { type: 'network' });

    expect(guest.closed).toEqual(['lost']);
    expect(peer().destroys).toBe(1);
  });
});

describe('PeerTransport — closing', () => {
  it('flushes the last message out before destroying the peer', async () => {
    const guest = make('guest', 'ABC234');
    await settle();
    peer().emit('open', 'some-random-id');
    const conn = peer().outgoing[0];
    conn?.goOpen();

    // What a leaving match does: say bye, then close.
    guest.transport.send({ t: 'bye', reason: 'left' });
    guest.transport.close();

    expect(conn?.sent).toEqual([{ t: 'bye', reason: 'left' }]);
    expect(conn?.closes).toEqual([{ flush: true }]);
    expect(peer().destroys).toBe(0); // still draining

    await vi.advanceTimersByTimeAsync(FLUSH_GRACE_MS);
    expect(peer().destroys).toBe(1);
  });

  it('destroys the peer as soon as the far end acknowledges the flush', async () => {
    const guest = make('guest', 'ABC234');
    await settle();
    peer().emit('open', 'some-random-id');
    const conn = peer().outgoing[0];
    conn?.goOpen();

    guest.transport.close();
    conn?.emit('close');
    expect(peer().destroys).toBe(1);

    // The grace timer must not destroy it a second time.
    await vi.advanceTimersByTimeAsync(FLUSH_GRACE_MS);
    expect(peer().destroys).toBe(1);
  });

  it('goes quiet after close, and closing twice changes nothing', async () => {
    const guest = make('guest', 'ABC234');
    await settle();
    peer().emit('open', 'some-random-id');
    const conn = peer().outgoing[0];
    conn?.goOpen();

    guest.transport.close();
    guest.transport.close();
    guest.transport.send(shot);
    conn?.emit('data', hello);
    conn?.emit('close');
    await vi.advanceTimersByTimeAsync(FLUSH_GRACE_MS * 4);

    expect(conn?.sent).toEqual([]);
    expect(conn?.closes).toEqual([{ flush: true }]); // once
    expect(guest.seen).toEqual([]);
    // Closing is the caller's own doing: it is not told what it already knows.
    expect(guest.closed).toEqual([]);
    expect(peer().destroys).toBe(1);
  });

  it('never builds a peer at all when it is closed before PeerJS arrives', async () => {
    const guest = make('guest', 'ABC234');
    guest.transport.send(hello);
    guest.transport.close();
    await settle();
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS * 2);

    expect(made).toHaveLength(0);
    expect(guest.closed).toEqual([]);
  });

  it('destroys the peer when there is nothing left to flush', async () => {
    const host = make('host', 'ABC234');
    await settle();
    peer().emit('open', 'broadside-ABC234');

    host.transport.close();
    expect(peer().destroys).toBe(1);
  });
});

describe('createTransport', () => {
  it('builds a peer transport synchronously', () => {
    const transport = createTransport('peer', 'host', 'ABC234');
    expect(transport.role).toBe('host');
    expect(made).toHaveLength(0); // PeerJS has not even been fetched yet
    transport.close();
  });
});

/**
 * Last on purpose: it swaps the mocked module for one that throws, which means
 * resetting the module registry. Anything after it would get a real PeerJS.
 */
describe('PeerTransport — PeerJS failing to load', () => {
  it('reads a chunk that will not load as the service being out of reach', async () => {
    vi.resetModules();
    vi.doMock('peerjs', () => {
      throw new Error('chunk load failed');
    });

    const fresh = await import('../../src/net/peerTransport');
    const closed: CloseReason[] = [];
    const transport = fresh.createPeerTransport('guest', 'ABC234');
    transport.onClose((why) => closed.push(why));
    await settle();

    expect(closed).toEqual(['unreachable']);
    expect(made).toHaveLength(0);
  });
});
