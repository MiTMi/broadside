/**
 * The transport two real devices play over: a WebRTC data channel, brokered by
 * PeerJS's free public signalling server (Decision N1). The broker only ever
 * sees the room id (`broadside-<CODE>`) and the metadata needed to introduce
 * the two browsers; every move travels directly between them.
 *
 * PeerJS itself is behind a dynamic `import()` so a solo player never runs a
 * line of it. `createPeerTransport` is still synchronous, like every other
 * transport (D10): it hands back a `Transport` that buffers sends and callbacks
 * until the module has loaded and the peer has answered.
 *
 * How the outside world's failures reach the caller — four of the `Transport`
 * contract's six close reasons come from here, and every PeerJS error is mapped
 * to one of them:
 *
 * | What happened                                    | Role  | Reported as                    |
 * |--------------------------------------------------|-------|--------------------------------|
 * | `unavailable-id` — the room id is taken (N9)     | host  | `unreachable` + `roomCodeTaken`|
 * | `peer-unavailable` — no such room                | guest | `timeout` (N9 "reach that game")|
 * | the data channel failed before it opened         | guest | `timeout`                      |
 * | nobody answered within 20 s                      | guest | `timeout`                      |
 * | the broker did not open the peer within 20 s     | host  | `unreachable`                  |
 * | `network`, `server-error`, `socket-*`, `ssl-*`,  | both  | `unreachable`                  |
 * |   `invalid-*`, `browser-incompatible`, `webrtc`, |       |                                |
 * |   or PeerJS itself failing to load               |       |                                |
 * | the data channel closed or failed mid-game       | both  | `lost`                         |
 *
 * The other two reasons are the match's to give, not the transport's. A second
 * guest is handed a `bye {reason:'full'}` *message* and then hung up on, so it
 * sees `onMessage(bye)` followed by `onClose('lost')` — and `OnlineMatch` reads
 * the bye and reports `full`. Same for a player who leaves: `bye {left}` then
 * `lost`, which the match reports as `peer-left`.
 *
 * Deliberately NOT mapped: once the data channel is open, broker-level trouble
 * (`disconnected`, `network`, a taken id on reconnect) is ignored — WebRTC keeps
 * working without the signalling server, and the public broker hiccups. The
 * channel dying is the only signal that a live game is over. Send failures
 * (`not-open-yet`, `message-too-big`) are not connection loss either.
 *
 * That ordering is the point: `close({flush: true})` queues the goodbye behind
 * the messages already in the channel, so a deliberate `bye` always arrives
 * before the close it rides ahead of.
 */
import { roomChannelName } from './localTransport';
import type { Msg } from './protocol';
import type { CloseReason, Transport, TransportRole } from './transport';
import type { DataConnection, Peer } from 'peerjs';

/** A guest gives up on a room after this long (N9). */
export const JOIN_TIMEOUT_MS = 20_000;
/** A host that cannot even register its room code has no game to offer. */
export const BROKER_TIMEOUT_MS = 20_000;
/**
 * How long the peer is kept alive after `close()` so the last message (the
 * `bye` the match sends just before leaving) can leave the data channel. Long
 * enough for a slow mobile round trip and a retransmit; the usual path is
 * shorter, because the far end's answering close destroys the peer at once.
 */
export const FLUSH_GRACE_MS = 1_000;

/**
 * Hosts whose room code was already registered with the broker. The `Transport`
 * contract has no reason for "that code is taken", and mapping it to `full` or
 * `unreachable` alone would send the player away from a game they can have by
 * simply trying another code — so the reason stays `unreachable` and the caller
 * asks here whether it should regenerate the code and create a new room (N9).
 */
const takenIds = new WeakSet<Transport>();

/** True if this host transport closed because its room code was already in use. */
export function roomCodeTaken(transport: Transport): boolean {
  return takenIds.has(transport);
}

export function createPeerTransport(role: TransportRole, code: string): Transport {
  const roomId = roomChannelName(code);

  const messageCbs: ((msg: unknown) => void)[] = [];
  const openCbs: (() => void)[] = [];
  const closeCbs: ((why: CloseReason) => void)[] = [];
  /** Sent before the channel opened — delivered in order the moment it does. */
  const queue: Msg[] = [];

  let peer: Peer | null = null;
  let conn: DataConnection | null = null;
  let opened = false;
  let closed = false;
  let destroyed = false;
  let deadline: ReturnType<typeof setTimeout> | null = deadlineTimer();
  let grace: ReturnType<typeof setTimeout> | null = null;

  function deadlineTimer(): ReturnType<typeof setTimeout> {
    // The clock starts now, not when PeerJS finishes loading: what the player
    // is waiting for is the whole trip, module and broker and handshake.
    return role === 'guest'
      ? setTimeout(() => fail('timeout'), JOIN_TIMEOUT_MS)
      : setTimeout(() => fail('unreachable'), BROKER_TIMEOUT_MS);
  }

  function clearDeadline(): void {
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
  }

  /** The connection is live: flush what was queued, then tell the caller. */
  function adopt(live: DataConnection): void {
    if (closed || conn !== null) return;
    conn = live;
    opened = true;
    clearDeadline();

    live.on('data', (data: unknown) => {
      // Raw and unvalidated on purpose: judging a message is the match's job (N5).
      if (!closed) for (const cb of messageCbs) cb(data);
    });
    live.on('close', () => fail('lost'));
    live.on('error', (error: { type?: string }) => {
      // A message that could not go out is not a connection that went away.
      if (error.type === 'negotiation-failed' || error.type === 'connection-closed') fail('lost');
    });

    for (const msg of queue.splice(0)) trySend(live, msg);
    for (const cb of openCbs) cb();
  }

  function trySend(live: DataConnection, msg: Msg): void {
    try {
      void live.send(msg);
    } catch {
      // A dead channel raises on send; the close event is what reports it.
    }
  }

  /** The connection ended for a reason the player needs to hear about. */
  function fail(why: CloseReason): void {
    if (closed) return;
    closed = true;
    clearDeadline();
    tearDown(false);
    for (const cb of closeCbs) cb(why);
  }

  /**
   * Lets go of the peer. `flush` is the deliberate-leave path: PeerJS's plain
   * `close()` drops whatever the data channel still holds, while `close({flush:
   * true})` queues a goodbye marker behind the pending messages — so the `bye`
   * the match sent a moment ago arrives before the channel goes down.
   */
  function tearDown(flush: boolean): void {
    const live = conn;
    conn = null;
    if (flush && live?.open) {
      try {
        live.close({ flush: true });
      } catch {
        destroyPeer();
        return;
      }
      live.on('close', destroyPeer);
      grace = setTimeout(destroyPeer, FLUSH_GRACE_MS);
      return;
    }
    try {
      live?.close();
    } catch {
      // Already gone; the peer is destroyed either way.
    }
    destroyPeer();
  }

  function destroyPeer(): void {
    if (destroyed) return;
    destroyed = true;
    if (grace !== null) clearTimeout(grace);
    grace = null;
    try {
      peer?.destroy();
    } catch {
      // Destroying twice, or destroying a peer that never opened, is harmless.
    }
    peer = null;
  }

  function start(Ctor: typeof Peer): void {
    if (closed) return;
    // The host IS the room: its broker id is the room code, so the guest needs
    // nothing but the code to find it (N8). The guest takes whatever id it is given.
    const self = role === 'host' ? new Ctor(roomId) : new Ctor();
    peer = self;

    self.on('error', (error: { type?: string }) => {
      // Once the players are talking, the broker is scenery (see the header).
      if (opened || closed) return;
      if (error.type === 'unavailable-id') {
        takenIds.add(transport);
        fail('unreachable');
        return;
      }
      if (error.type === 'peer-unavailable') {
        fail('timeout');
        return;
      }
      if (error.type === 'disconnected') return;
      fail('unreachable');
    });

    self.on('disconnected', () => {
      // The broker dropped us. With a live channel that changes nothing; before
      // one, it is worth a single attempt to get the socket back — and if that
      // does not work, the deadline above ends the wait.
      if (opened || closed || self.destroyed) return;
      try {
        self.reconnect();
      } catch {
        // Nothing else to try; the deadline reports it.
      }
    });

    if (role === 'host') {
      self.on('open', clearDeadline);
      self.on('connection', (incoming: DataConnection) => {
        // Not "the first connection" but the first one that actually opens: a
        // guest whose NAT traversal fails must not use up the room.
        incoming.on('open', () => {
          if (closed) return;
          if (conn === null) {
            adopt(incoming);
            return;
          }
          if (incoming === conn) return;
          // Two players is the whole game (N9). Tell the third why, then hang up.
          trySend(incoming, { t: 'bye', reason: 'full' });
          try {
            incoming.close({ flush: true });
          } catch {
            // It is leaving either way.
          }
        });
      });
      return;
    }

    self.on('open', () => {
      if (closed) return;
      const outgoing = self.connect(roomId, { reliable: true, serialization: 'json' });
      // PeerJS answers with `undefined` (and an error event) if the socket died
      // between opening and now.
      if (!outgoing) return;
      outgoing.on('open', () => adopt(outgoing));
      // Before it opens, a channel that closes or fails is a room we could not
      // reach — the same thing the deadline would say, said sooner.
      outgoing.on('close', () => {
        if (!opened) fail('timeout');
      });
      outgoing.on('error', () => {
        if (!opened) fail('timeout');
      });
    });
  }

  const transport: Transport = {
    role,

    send(msg: Msg): void {
      if (closed) return;
      if (conn === null) queue.push(msg);
      else trySend(conn, msg);
    },

    onMessage(cb: (msg: unknown) => void): void {
      messageCbs.push(cb);
    },

    onOpen(cb: () => void): void {
      openCbs.push(cb);
      // Late listeners are told what they missed, as every transport does (D10).
      if (opened && !closed) cb();
    },

    onClose(cb: (why: CloseReason) => void): void {
      closeCbs.push(cb);
    },

    /**
     * Leaving for good. Nothing is sent from here — the match says `bye` itself
     * (N7) — but that message is given its chance to leave before the peer is
     * destroyed. Everything here is synchronous, so it also works on the way
     * out of the page (`pagehide` → `leave()` → here, D10); the grace timer
     * simply never runs, and the browser tears the connection down for us.
     */
    close(): void {
      if (closed) return;
      closed = true;
      clearDeadline();
      tearDown(true);
    },
  };

  // The one place PeerJS is pulled in. A failure here (offline, blocked chunk)
  // is indistinguishable from the broker being out of reach, and reads the same.
  void import('peerjs')
    .then((module) => start(module.Peer))
    .catch(() => fail('unreachable'));

  return transport;
}
