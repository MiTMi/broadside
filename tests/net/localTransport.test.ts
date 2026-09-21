/**
 * Node has a real `BroadcastChannel`, so these are the real thing: two (and
 * three) transports on one room code, in one process.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalTransport, createTransport, roomChannelName } from '../../src/net/index';
import type { CloseReason, Msg, Transport } from '../../src/net/index';

const open: Transport[] = [];

/** Channel delivery is a macrotask away; nothing here needs a real wait. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function make(role: 'host' | 'guest', code: string): { transport: Transport; seen: unknown[]; opened: number; closed: CloseReason[] } {
  const transport = createLocalTransport(role, code);
  open.push(transport);
  const box = { transport, seen: [] as unknown[], opened: 0, closed: [] as CloseReason[] };
  transport.onMessage((msg) => box.seen.push(msg));
  transport.onOpen(() => {
    box.opened += 1;
  });
  transport.onClose((why) => box.closed.push(why));
  return box;
}

const hello: Msg = { t: 'hello', v: 1, build: 'test' };

afterEach(() => {
  for (const transport of open.splice(0)) transport.close();
});

describe('LocalTransport', () => {
  it('names its channel after the room code', () => {
    expect(roomChannelName('ABC234')).toBe('broadside-ABC234');
  });

  it('opens both sides once the guest joins, whichever started first', async () => {
    const host = make('host', 'ROOM01');
    await settle();
    expect(host.opened).toBe(0); // nobody there yet

    const guest = make('guest', 'ROOM01');
    await settle();
    expect(host.opened).toBe(1);
    expect(guest.opened).toBe(1);
    expect(host.transport.role).toBe('host');
    expect(guest.transport.role).toBe('guest');
  });

  it('opens when the guest was waiting first', async () => {
    const guest = make('guest', 'ROOM02');
    await settle();
    expect(guest.opened).toBe(0);

    const host = make('host', 'ROOM02');
    await settle();
    expect(guest.opened).toBe(1);
    expect(host.opened).toBe(1);
  });

  it('carries messages both ways, in order, and never back to the sender', async () => {
    const host = make('host', 'ROOM03');
    const guest = make('guest', 'ROOM03');
    await settle();

    host.transport.send(hello);
    host.transport.send({ t: 'shot', seq: 1, coord: { row: 2, col: 3 } });
    guest.transport.send({ t: 'ready', commit: null });
    await settle();

    expect(guest.seen).toEqual([hello, { t: 'shot', seq: 1, coord: { row: 2, col: 3 } }]);
    expect(host.seen).toEqual([{ t: 'ready', commit: null }]);
  });

  it('delivers what was sent before the peer arrived, in order', async () => {
    const host = make('host', 'ROOM04');
    host.transport.send(hello);
    host.transport.send({ t: 'rematch' });
    await settle();

    const guest = make('guest', 'ROOM04');
    await settle();
    expect(guest.seen).toEqual([hello, { t: 'rematch' }]);
  });

  it('keeps two rooms apart', async () => {
    const host = make('host', 'ROOM05');
    const guest = make('guest', 'ROOM05');
    const stranger = make('guest', 'ROOM06');
    await settle();

    host.transport.send(hello);
    await settle();
    expect(guest.seen).toEqual([hello]);
    expect(stranger.seen).toEqual([]);
    expect(stranger.opened).toBe(0);
  });

  it('turns a third player away with "full"', async () => {
    const host = make('host', 'ROOM07');
    const guest = make('guest', 'ROOM07');
    await settle();

    const third = make('guest', 'ROOM07');
    await settle();
    expect(third.closed).toEqual(['full']);
    expect(third.opened).toBe(0);
    // The game in progress is untouched.
    expect(host.opened).toBe(1);
    expect(guest.closed).toEqual([]);
    host.transport.send(hello);
    await settle();
    expect(guest.seen).toEqual([hello]);
    expect(third.seen).toEqual([]);
  });

  it('tells the peer when a side closes, and goes quiet afterwards', async () => {
    const host = make('host', 'ROOM08');
    const guest = make('guest', 'ROOM08');
    await settle();

    host.transport.close();
    await settle();
    expect(guest.closed).toEqual(['peer-left']);
    // The side that left is not told what it already knows.
    expect(host.closed).toEqual([]);

    host.transport.send(hello);
    guest.transport.send(hello);
    await settle();
    expect(guest.seen).toEqual([]);
    expect(host.seen).toEqual([]);
    expect(guest.closed).toEqual(['peer-left']); // once, not twice
  });

  it('reports a guest leaving to the host', async () => {
    const host = make('host', 'ROOM09');
    const guest = make('guest', 'ROOM09');
    await settle();
    guest.transport.close();
    await settle();
    expect(host.closed).toEqual(['peer-left']);
  });

  it('tells the host when a guest leaves before it ever saw the accept', async () => {
    const host = make('host', 'ROOM10');
    await settle();
    const guest = make('guest', 'ROOM10');
    // Closed in the same tick it joined: the guest never learned the host's id.
    guest.transport.close();
    await settle();
    expect(host.opened).toBe(1);
    expect(host.closed).toEqual(['peer-left']);
  });

  it('calls a late onOpen straight away', async () => {
    const host = make('host', 'ROOM10');
    make('guest', 'ROOM10');
    await settle();

    let late = 0;
    host.transport.onOpen(() => {
      late += 1;
    });
    expect(late).toBe(1);
  });
});

describe('createTransport', () => {
  it('builds a local transport', async () => {
    const host = createTransport('local', 'host', 'ROOM11');
    open.push(host);
    expect(host.role).toBe('host');
  });

  it('builds a peer transport without waiting for PeerJS to load', () => {
    // The real thing is covered in peerTransport.test.ts against a mocked
    // module; what matters here is that the factory still answers at once (D10).
    const host = createTransport('peer', 'host', 'ROOM12');
    expect(host.role).toBe('host');
    host.close();
  });
});
