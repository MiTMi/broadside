/**
 * The seam between a match and however its two devices are connected
 * (Decision N2). `LocalTransport` (BroadcastChannel, two tabs of one browser)
 * is the deterministic one used by tests and `?transport=local`; the PeerJS
 * WebRTC transport is the one real players use.
 *
 * A transport moves opaque JSON and reports connection facts. It never
 * validates, interprets or answers a message: that is the match's job (N5).
 */
import { createLocalTransport } from './localTransport';
import { createPeerTransport } from './peerTransport';
import type { Msg } from './protocol';

export type TransportRole = 'host' | 'guest';

export type CloseReason =
  | 'peer-left' // the other side said goodbye or went away
  | 'lost' // the connection dropped mid-game
  | 'unreachable' // the connection service could not be reached
  | 'timeout' // nobody answered in time
  | 'full' // that room already has two players
  | 'closed'; // the transport was shut down under us (page going away)

export interface Transport {
  readonly role: TransportRole;
  /** Sends a message. A no-op once the transport is closed. */
  send(msg: Msg): void;
  /** Raw, unvalidated peer input. */
  onMessage(cb: (msg: unknown) => void): void;
  /** The peer is there — fires for both roles, at most once per connection. */
  onOpen(cb: () => void): void;
  onClose(cb: (why: CloseReason) => void): void;
  /** Leaves for good. Does not call `onClose`: the caller already knows. */
  close(): void;
}

export type TransportKind = 'peer' | 'local';

/**
 * Synchronous on purpose (D10): the peer transport loads PeerJS in the
 * background and buffers until it is there, so the caller never waits on a
 * module to get a `Transport` back.
 */
export function createTransport(kind: TransportKind, role: TransportRole, code: string): Transport {
  return kind === 'local' ? createLocalTransport(role, code) : createPeerTransport(role, code);
}
