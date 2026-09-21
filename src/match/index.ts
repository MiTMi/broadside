// The UI imports the match layer only through this barrel.
export type {
  Match,
  MatchEnd,
  MatchMessages,
  MatchMode,
  MatchPhase,
  MatchSide,
  MatchView,
  RematchState,
  SfxEvent,
  Verification,
} from './match';
export { createSoloMatch } from './soloMatch';
export type { CpuAdapter, CpuTurnRequest, SoloMatchOptions } from './soloMatch';
export { MAX_INVALID, createOnlineMatch } from './onlineMatch';
export type { OnlineMatchOptions } from './onlineMatch';
