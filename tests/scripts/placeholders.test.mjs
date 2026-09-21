/**
 * `--placeholders`: local stand-in art at the Contract sizes, written only for
 * names that have no optimized file yet.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { ASSETS } from '../../scripts/lib/config.mjs';
import { runPlaceholders } from '../../scripts/lib/placeholders.mjs';
import { createTempPaths, removeTempPaths } from './helpers.mjs';

/** @type {import('../../scripts/lib/config.mjs').Paths} */
let paths;
/** @type {{ paths: typeof paths, sharp: typeof sharp, log: (m: string) => void }} */
let deps;

beforeEach(() => {
  paths = createTempPaths();
  deps = { paths, sharp, log: () => {} };
});
afterEach(() => {
  removeTempPaths(paths);
});

describe('runPlaceholders', () => {
  it('writes all 12 files at the Contract sizes', async () => {
    const result = await runPlaceholders(deps, ASSETS);

    expect(result.written).toHaveLength(12);
    expect(result.skipped).toEqual([]);

    for (const asset of ASSETS) {
      const file = path.join(paths.optimizedDir, asset.optimized);
      expect(fs.existsSync(file), `${asset.name} → ${asset.optimized}`).toBe(true);
      const meta = await sharp(file).metadata();
      expect(meta.format).toBe('webp');

      if (asset.kind === 'ship') {
        expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(asset.longEdge);
        expect(meta.hasAlpha).toBe(true);
      } else {
        expect([meta.width, meta.height]).toEqual([asset.width, asset.height]);
      }
    }
  });

  it('draws ships with a transparent surround and an opaque hull', async () => {
    const [carrier] = ASSETS;
    await runPlaceholders(deps, [/** @type {never} */ (carrier)]);

    const file = path.join(paths.optimizedDir, /** @type {never} */ (carrier).optimized);
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    /** @param {number} x @param {number} y */
    const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];

    expect(alphaAt(1, 1)).toBe(0);
    expect(alphaAt(info.width - 2, 1)).toBe(0);
    expect(alphaAt(Math.round(info.width / 2), Math.round(info.height / 2))).toBe(255);
    // Bow points right: the hull reaches further right at mid-height than the
    // transparent corner, and the stern half is taller than the bow half.
    expect(alphaAt(info.width - 6, Math.round(info.height / 2))).toBeGreaterThan(0);
    expect(alphaAt(info.width - 6, Math.round(info.height * 0.2))).toBe(0);
  });

  it('never touches an optimized file that already exists', async () => {
    const existing = path.join(paths.optimizedDir, 'table.webp');
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(existing, 'not really a webp, but it exists');
    const before = fs.readFileSync(existing);

    const result = await runPlaceholders(deps, ASSETS);

    expect(result.skipped).toEqual(['table']);
    expect(result.written).toHaveLength(11);
    expect(fs.readFileSync(existing).equals(before)).toBe(true);
  });

  it('is idempotent: a second run writes nothing', async () => {
    await runPlaceholders(deps, ASSETS);
    const second = await runPlaceholders(deps, ASSETS);

    expect(second.written).toEqual([]);
    expect(second.skipped).toHaveLength(12);
  });

  it('never writes into assets/original', async () => {
    await runPlaceholders(deps, ASSETS);
    expect(fs.readdirSync(paths.originalDir)).toEqual([]);
  });
});
