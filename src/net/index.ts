// The UI imports the net layer only through this barrel.
export { PROTOCOL_VERSION, BUILD_ID, parseMsg, helloVersion } from './protocol';
export type { ByeReason, Msg } from './protocol';
export { createTransport } from './transport';
export type { CloseReason, Transport, TransportKind, TransportRole } from './transport';
export { createLocalTransport, roomChannelName } from './localTransport';
export { createPeerTransport, roomCodeTaken } from './peerTransport';
export {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_PARAM,
  generateRoomCode,
  isRoomCode,
  normaliseRoomCode,
  roomFromHref,
  roomLink,
} from './roomCode';
export type { RandomBytes } from './roomCode';
export { commitFleet, commitPayload, fleetMatchesResults, randomSalt } from './commitment';
export type { CommitFn } from './commitment';
