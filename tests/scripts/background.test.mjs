/**
 * PLAN P6 — border-connected flood-fill background removal, on synthetic
 * images so the expectations are exact: white that touches the border goes,
 * white *inside* the hull stays.
 */

import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { contentBounds, removeBackground } from '../../scripts/lib/background.mjs';
import { selectAssets } from '../../scripts/lib/config.mjs';
import { processAsset } from '../../scripts/lib/process.mjs';
import { createTempPaths, removeTempPaths } from './helpers.mjs';

const WIDTH = 200;
const HEIGHT = 100;

/**
 * White frame, a grey blob with a dark outline in the middle, and a pure-white
 * detail square inside the blob (a deck marking).
 *
 * @returns {{ data: Uint8Array, width: number, height: number, channels: 3 }}
 */
function syntheticShip() {
  const data = new Uint8Array(WIDTH * HEIGHT * 3).fill(255);
  /** @param {number} x @param {number} y @param {[number, number, number]} rgb */
  const set = (x, y, rgb) => {
    const offset = (y * WIDTH + x) * 3;
    data[offset] = rgb[0];
    data[offset + 1] = rgb[1];
    data[offset + 2] = rgb[2];
  };

  // A tapered hull, so the corners of its bounding box are background too.
  for (let y = 25; y < 75; y++) {
    const t = (y - 49.5) / 24.5;
    const inset = Math.round(18 * t * t);
    const from = 40 + inset;
    const to = 160 - inset;
    for (let x = from; x < to; x++) {
      const edge = y === 25 || y === 74 || x === from || x === to - 1;
      set(x, y, edge ? [23, 74, 124] : [140, 151, 163]);
    }
  }
  // A pure-white detail well inside the hull: it must survive.
  for (let y = 45; y < 55; y++) for (let x = 90; x < 110; x++) set(x, y, [255, 255, 255]);

  return { data, width: WIDTH, height: HEIGHT, channels: 3 };
}

describe('removeBackground', () => {
  const image = syntheticShip();
  const result = removeBackground(image, { tolerance: 0.12 });
  /** @param {number} x @param {number} y */
  const alphaAt = (x, y) => result.data[(y * WIDTH + x) * 4 + 3];

  it('clears the white that is connected to the border', () => {
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(WIDTH - 1, 0)).toBe(0);
    expect(alphaAt(0, HEIGHT - 1)).toBe(0);
    expect(alphaAt(WIDTH - 1, HEIGHT - 1)).toBe(0);
    expect(alphaAt(20, 50)).toBe(0);
  });

  it('keeps the hull and the white detail inside it fully opaque', () => {
    expect(alphaAt(100, 50)).toBe(255); // the white deck marking
    expect(alphaAt(60, 50)).toBe(255); // grey hull
    expect(alphaAt(40, 50)).toBeGreaterThan(150); // dark outline, feathered at the very edge
  });

  it('reports the tight content box for trimming', () => {
    expect(result.bounds).toEqual({ left: 40, top: 25, width: 120, height: 50 });
  });

  it('feathers exactly one pixel at the cut edge', () => {
    // The pixel just outside the outline is background (0); the outline itself
    // is opaque; nothing in between is a hard staircase of 255s.
    expect(alphaAt(39, 50)).toBe(0);
    expect(alphaAt(40, 24)).toBe(0);
    expect(result.removed).toBeGreaterThan(0);
    expect(result.removed).toBeLessThan(WIDTH * HEIGHT);
  });

  it('never recurses — a large image is handled iteratively', () => {
    const big = { data: new Uint8Array(1200 * 900 * 3).fill(255), width: 1200, height: 900, channels: 3 };
    const cut = removeBackground(big, { feather: false });
    expect(cut.removed).toBe(1200 * 900);
  });

  it('falls back to the full frame when nothing survives', () => {
    expect(contentBounds(new Uint8Array(4), 2, 2)).toEqual({ left: 0, top: 0, width: 2, height: 2 });
  });
});

describe('processAsset on a ship original', () => {
  /** @type {import('../../scripts/lib/config.mjs').Paths} */
  let paths;
  beforeEach(() => {
    paths = createTempPaths();
  });
  afterEach(() => {
    removeTempPaths(paths);
  });

  it('cuts the background, trims to content and resizes to the Contract long edge', async () => {
    const image = syntheticShip();
    await sharp(Buffer.from(image.data), { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
      .png()
      .toFile(`${paths.originalDir}/ship-carrier.png`);

    const [asset] = selectAssets(['ship-carrier']);
    const result = await processAsset({ paths, sharp, log: () => {} }, /** @type {never} */ (asset));

    expect(result.width).toBe(640); // Contract: 640 px long edge
    expect(result.height).toBe(Math.round((640 * 50) / 120)); // trimmed 120×50 box, aspect kept
    expect(fs.existsSync(result.path)).toBe(true);

    const meta = await sharp(result.path).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.hasAlpha).toBe(true);

    const { data, info } = await sharp(result.path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    /** @param {number} x @param {number} y */
    const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
    expect(alphaAt(2, 2)).toBeLessThan(40); // the tapered bow leaves the box corner empty
    expect(alphaAt(Math.round(info.width / 2), Math.round(info.height / 2))).toBeGreaterThan(200);
  });
});
