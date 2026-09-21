/**
 * Background removal for ship sprites (PLAN P6).
 *
 * No image model can emit alpha, so ships are generated on pure white and the
 * white is removed here. Naively keying every near-white pixel would punch
 * holes through white details *inside* the hull (deck markings, highlights),
 * so only near-white pixels that are **connected to the image border** are
 * removed — an iterative flood fill (a 1k image is >1M pixels; recursion would
 * blow the stack).
 *
 * Pure array maths, no sharp: the unit tests run it on synthetic images.
 */

import { BACKGROUND_TOLERANCE } from './config.mjs';

/**
 * @typedef {{ data: Uint8Array | Buffer, width: number, height: number, channels: number }} RawImage
 * @typedef {{ left: number, top: number, width: number, height: number }} Bounds
 */

/**
 * @param {RawImage} image
 * @param {{ tolerance?: number, alphaThreshold?: number, feather?: boolean }} [options]
 * @returns {{ data: Uint8Array, width: number, height: number, channels: 4, bounds: Bounds, removed: number }}
 */
export function removeBackground(image, options = {}) {
  const { width, height, channels } = image;
  const tolerance = options.tolerance ?? BACKGROUND_TOLERANCE;
  const feather = options.feather ?? true;
  const alphaThreshold = options.alphaThreshold ?? 8;

  if (channels !== 3 && channels !== 4) throw new Error(`Expected 3 or 4 channels, got ${channels}.`);

  const pixels = width * height;
  const cutoff = 255 - Math.round(tolerance * 255);
  const source = image.data;

  /** 1 = background (near-white and reachable from the border). */
  const background = new Uint8Array(pixels);
  const stack = new Int32Array(pixels);
  let top = 0;

  /** @param {number} index */
  const isNearWhite = (index) => {
    const offset = index * channels;
    const r = source[offset] ?? 0;
    const g = source[offset + 1] ?? 0;
    const b = source[offset + 2] ?? 0;
    if (channels === 4 && (source[offset + 3] ?? 255) < 8) return true; // already transparent
    return r >= cutoff && g >= cutoff && b >= cutoff;
  };

  /** Mark a near-white, not-yet-visited pixel as background and queue it. */
  /** @param {number} index */
  const push = (index) => {
    if (background[index] === 1 || !isNearWhite(index)) return;
    background[index] = 1;
    stack[top++] = index;
  };

  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }

  while (top > 0) {
    const index = stack[--top] ?? 0;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }

  let removed = 0;
  for (let i = 0; i < pixels; i++) if (background[i] === 1) removed++;

  // Binary alpha, then a one-pixel feather so the cut edge is not a staircase.
  const alpha = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) alpha[i] = background[i] === 1 ? 0 : 255;

  if (feather) {
    const feathered = Uint8Array.from(alpha);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        if (alpha[index] === 0) continue;
        let opaque = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (alpha[ny * width + nx] === 255) opaque++;
          }
        }
        if (opaque < 9) feathered[index] = Math.round((255 * opaque) / 9);
      }
    }
    alpha.set(feathered);
  }

  const data = new Uint8Array(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    const from = i * channels;
    const to = i * 4;
    data[to] = source[from] ?? 0;
    data[to + 1] = source[from + 1] ?? 0;
    data[to + 2] = source[from + 2] ?? 0;
    const existing = channels === 4 ? (source[from + 3] ?? 255) : 255;
    data[to + 3] = Math.round((existing * (alpha[i] ?? 0)) / 255);
  }

  return { data, width, height, channels: 4, bounds: contentBounds(alpha, width, height, alphaThreshold), removed };
}

/**
 * The tightest box containing everything that survived the cut.
 *
 * @param {Uint8Array} alpha
 * @param {number} width
 * @param {number} height
 * @param {number} [threshold]
 * @returns {Bounds} the full frame when nothing survived
 */
export function contentBounds(alpha, width, height, threshold = 8) {
  let left = width;
  let topEdge = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((alpha[y * width + x] ?? 0) <= threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < topEdge) topEdge = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < 0 || bottom < 0) return { left: 0, top: 0, width, height };
  return { left, top: topEdge, width: right - left + 1, height: bottom - topEdge + 1 };
}
