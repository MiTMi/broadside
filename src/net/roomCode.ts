/**
 * Room codes: 6 characters from an alphabet with no 0/O and no 1/I, so a code
 * read aloud or copied off a screen cannot be mistyped into someone else's game
 * (Decision N8). `crypto.getRandomValues` is allowed here and nowhere else.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
/** The query parameter of a deep link: `?room=ABC234`. */
export const ROOM_PARAM = 'room';

/** Bytes in, code out — injectable so tests can check the mapping. */
export type RandomBytes = (size: number) => Uint8Array;

export function generateRoomCode(random: RandomBytes = cryptoBytes): string {
  const bytes = random(ROOM_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    // The alphabet is exactly 32 long, so five bits map onto it without bias.
    code += ROOM_CODE_ALPHABET[(bytes[i] ?? 0) & 31] ?? '';
  }
  return code;
}

/** What someone typed, as a code: upper case, no spaces or dashes, 6 long. */
export function normaliseRoomCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, '').slice(0, ROOM_CODE_LENGTH);
}

export function isRoomCode(code: string): boolean {
  return (
    code.length === ROOM_CODE_LENGTH && [...code].every((char) => ROOM_CODE_ALPHABET.includes(char))
  );
}

/** The link to share: the current page with `?room=CODE`. */
export function roomLink(code: string, href: string): string {
  const url = new URL(href);
  url.searchParams.set(ROOM_PARAM, code);
  // Never share a debug seed: the friend would draw the same "random" fleet and
  // could work out where the host's ships are.
  url.searchParams.delete('seed');
  url.hash = '';
  return url.toString();
}

/** The code in a deep link, or null if there is none worth trying. */
export function roomFromHref(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const raw = url.searchParams.get(ROOM_PARAM);
  if (raw === null) return null;
  const code = normaliseRoomCode(raw);
  return isRoomCode(code) ? code : null;
}

function cryptoBytes(size: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(size));
}
