/**
 * Recorded sound effects for the big moments of a battle. They are real
 * recordings from Pixabay (see `src/assets/sounds/CREDITS.md`), trimmed,
 * normalised and compressed to small mono MP3s, and inlined into the single-file
 * build like every other asset. This is the only module that imports audio files.
 *
 * The short interface cues (peg tick, select, place, start) stay synthesized in
 * `sound.ts`; if a sample is missing or fails to decode, `sound.ts` falls back
 * to its synthesized version of the same cue, so the game is never silent.
 */
import hitUrl from '../assets/sounds/hit.mp3';
import missUrl from '../assets/sounds/miss.mp3';
import sunkUrl from '../assets/sounds/sunk.mp3';
import winUrl from '../assets/sounds/win.mp3';
import loseUrl from '../assets/sounds/lose.mp3';

export type SampleName = 'hit' | 'miss' | 'sunk' | 'win' | 'lose';

/** `gain` is applied before the master (0.7) and the limiter. */
export const SAMPLES: Record<SampleName, { url: string; gain: number }> = {
  hit: { url: hitUrl, gain: 0.95 },
  miss: { url: missUrl, gain: 0.4 },
  sunk: { url: sunkUrl, gain: 1 },
  win: { url: winUrl, gain: 0.75 },
  lose: { url: loseUrl, gain: 0.75 },
};

/**
 * The bytes behind an asset URL. The production build inlines assets as
 * `data:` URIs, which are decoded here without touching the network (so the
 * game keeps working from `file://`); the dev server hands out real URLs.
 */
export async function loadSampleBytes(url: string): Promise<ArrayBuffer> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    const meta = url.slice(0, comma);
    const payload = url.slice(comma + 1);
    if (!meta.includes(';base64')) return new TextEncoder().encode(decodeURIComponent(payload)).buffer;
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`sample request failed: ${response.status}`);
  return response.arrayBuffer();
}
