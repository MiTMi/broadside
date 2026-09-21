/**
 * The sound seam. The UI only ever talks to this interface, so T3 can add a
 * real WebAudio implementation in `sound.ts` and swap it in from `main.ts`
 * without touching any view.
 *
 * The cue names live in `match/match.ts` — a match asks for them (`onSfx`) and
 * this layer decides what they sound like.
 */
import type { SfxEvent } from '../match/index';

export type { SfxEvent };

export interface Sfx {
  /** Plays a cue. Must never throw and must be safe before the first gesture. */
  play(event: SfxEvent): void;
  isMuted(): boolean;
  setMuted(muted: boolean): void;
}

/** The default: remembers the mute state so the header toggle works, plays nothing. */
export function createSilentSfx(): Sfx {
  let muted = false;
  return {
    play: (): void => {},
    isMuted: (): boolean => muted,
    setMuted: (next: boolean): void => {
      muted = next;
    },
  };
}
