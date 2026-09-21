/**
 * Two tabs of one browser, over a `BroadcastChannel` named after the room code
 * — no network, no broker, nothing to be flaky (Decision N2). It is what
 * `?transport=local` and the two-page e2e run on, and it is the reference
 * implementation of the `Transport` contract.
 *
 * Handshake: the host announces itself, the guest asks to join, the host
 * accepts the first guest and tells any later one the room is full. Either side
 * saying goodbye (or closing) surfaces as `peer-left` on the other.
 *
 * `BroadcastChannel` is allowed here and nowhere else in `src/net`.
 */
import type { Msg } from './protocol';
import type { CloseReason, Transport, TransportRole } from './transport';

/** Shared with the PeerJS transport: one room code, one name, one namespace. */
export function roomChannelName(code: string): string {
  return `broadside-${code}`;
}

type Envelope =
  | { k: 'hi'; from: 'host'; id: string }
  | { k: 'join'; from: 'guest'; id: string }
  | { k: 'accept'; from: 'host'; id: string; to: string }
  | { k: 'full'; from: 'host'; id: string; to: string }
  | { k: 'msg'; from: TransportRole; id: string; to: string; msg: Msg }
  | { k: 'bye'; from: TransportRole; id: string; to: string };

export function createLocalTransport(role: TransportRole, code: string): Transport {
  const id = newId();
  const channel = new BroadcastChannel(roomChannelName(code));
  // Node keeps the event loop alive for an open channel; tests must be able to end.
  (channel as unknown as { unref?: () => void }).unref?.();

  const messageCbs: ((msg: unknown) => void)[] = [];
  const openCbs: (() => void)[] = [];
  const closeCbs: ((why: CloseReason) => void)[] = [];

  let peerId: string | null = null;
  let closed = false;
  /** Sent before the peer arrived — delivered in order the moment it does. */
  const queue: Msg[] = [];

  function post(envelope: Envelope): void {
    if (closed) return;
    channel.postMessage(envelope);
  }

  function open(peer: string): void {
    peerId = peer;
    for (const msg of queue.splice(0)) post({ k: 'msg', from: role, id, to: peer, msg });
    for (const cb of openCbs) cb();
  }

  function shutDown(why: CloseReason): void {
    if (closed) return;
    closed = true;
    channel.onmessage = null;
    channel.close();
    for (const cb of closeCbs) cb(why);
  }

  channel.onmessage = (event: MessageEvent): void => {
    if (closed) return;
    const envelope = event.data as Envelope | null;
    if (!envelope || typeof envelope !== 'object' || envelope.from === role) return;

    switch (envelope.k) {
      case 'hi':
        // A host that started after us: ask again, our first join was shouted
        // into an empty room.
        if (role === 'guest' && peerId === null) post({ k: 'join', from: 'guest', id });
        return;
      case 'join':
        if (role !== 'host') return;
        if (peerId === null) {
          post({ k: 'accept', from: 'host', id, to: envelope.id });
          open(envelope.id);
        } else if (peerId === envelope.id) {
          post({ k: 'accept', from: 'host', id, to: envelope.id });
        } else {
          // Two is the whole game (N9).
          post({ k: 'full', from: 'host', id, to: envelope.id });
        }
        return;
      case 'accept':
        if (role === 'guest' && peerId === null && envelope.to === id) open(envelope.id);
        return;
      case 'full':
        if (role === 'guest' && peerId === null && envelope.to === id) shutDown('full');
        return;
      case 'msg':
        if (envelope.to !== id || envelope.id !== peerId) return;
        for (const cb of messageCbs) cb(envelope.msg);
        return;
      case 'bye':
        // `to` is empty when a guest left before it ever saw our accept: it
        // cannot know our id yet, but we may already have opened against it.
        if (envelope.id !== peerId || (envelope.to !== id && envelope.to !== '')) return;
        shutDown('peer-left');
        return;
      default:
        return;
    }
  };

  post(role === 'host' ? { k: 'hi', from: 'host', id } : { k: 'join', from: 'guest', id });

  return {
    role,

    send(msg: Msg): void {
      if (closed) return;
      if (peerId === null) queue.push(msg);
      else post({ k: 'msg', from: role, id, to: peerId, msg });
    },

    onMessage(cb: (msg: unknown) => void): void {
      messageCbs.push(cb);
    },

    onOpen(cb: () => void): void {
      openCbs.push(cb);
      if (peerId !== null) cb();
    },

    onClose(cb: (why: CloseReason) => void): void {
      closeCbs.push(cb);
    },

    close(): void {
      if (closed) return;
      // An unpaired guest still says goodbye, or a host that opened on our
      // 'join' would wait for a ghost forever (BroadcastChannel has no liveness).
      if (peerId !== null) post({ k: 'bye', from: role, id, to: peerId });
      else if (role === 'guest') post({ k: 'bye', from: role, id, to: '' });
      closed = true;
      channel.onmessage = null;
      channel.close();
    },
  };
}

function newId(): string {
  const source: { randomUUID?: () => string } | undefined = globalThis.crypto;
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}
