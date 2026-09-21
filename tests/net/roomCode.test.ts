import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  generateRoomCode,
  isRoomCode,
  normaliseRoomCode,
  roomFromHref,
  roomLink,
} from '../../src/net/index';

describe('room codes', () => {
  it('has an alphabet nobody can mistype', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(32); // exactly 5 bits: no modulo bias
    for (const confusing of ['0', 'O', '1', 'I']) {
      expect(ROOM_CODE_ALPHABET).not.toContain(confusing);
    }
  });

  it('generates codes from the alphabet, using every byte', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode();
      expect(isRoomCode(code)).toBe(true);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      codes.add(code);
    }
    expect(codes.size).toBeGreaterThan(490); // 32^6 ≈ 1e9: collisions would be news
  });

  it('maps bytes onto the alphabet by their low five bits', () => {
    const bytes = (size: number): Uint8Array =>
      Uint8Array.from({ length: size }, (_, i) => i + 32 * 3); // 96, 97, … wraps to 0, 1, …
    expect(generateRoomCode(bytes)).toBe(
      ROOM_CODE_ALPHABET.slice(0, ROOM_CODE_LENGTH),
    );
  });

  it('tidies up what someone types', () => {
    expect(normaliseRoomCode(' abc 234 ')).toBe('ABC234');
    expect(normaliseRoomCode('abc-234')).toBe('ABC234');
    expect(normaliseRoomCode('ABC234EXTRA')).toBe('ABC234');
    expect(normaliseRoomCode('')).toBe('');
  });

  it('validates the alphabet, not just the length', () => {
    expect(isRoomCode('ABC234')).toBe(true);
    expect(isRoomCode('ABC23')).toBe(false);
    expect(isRoomCode('ABC2345')).toBe(false);
    expect(isRoomCode('ABC23O')).toBe(false); // O is not in the alphabet
    expect(isRoomCode('abc234')).toBe(false); // normalise first
    expect(isRoomCode('ABC 23')).toBe(false);
  });

  it('builds and reads a deep link', () => {
    const link = roomLink('ABC234', 'https://example.com/broadside/?seed=7#top');
    // The debug seed is never shared: it would give the friend the host's "random" fleet.
    expect(link).toBe('https://example.com/broadside/?room=ABC234');
    expect(roomLink('ABC234', 'https://example.com/broadside/?transport=local&seed=7')).toBe(
      'https://example.com/broadside/?transport=local&room=ABC234',
    );
    expect(roomFromHref(link)).toBe('ABC234');
    expect(roomFromHref(roomLink('ABC234', 'https://example.com/?room=OLD999'))).toBe('ABC234');
    expect(roomFromHref('https://example.com/')).toBeNull();
    expect(roomFromHref('https://example.com/?room=nope')).toBeNull();
    expect(roomFromHref('https://example.com/?room=abc234')).toBe('ABC234');
    expect(roomFromHref('not a url')).toBeNull();
  });
});
