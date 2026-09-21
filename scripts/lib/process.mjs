/**
 * `--process`: paid originals in `assets/original/` → optimized files the game
 * imports from `src/assets/` (PLAN P6/P7). Free and offline, so the tolerance
 * can be re-tuned and re-run as often as needed.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CliError } from './errors.mjs';
import { BACKGROUND_TOLERANCE } from './config.mjs';
import { removeBackground } from './background.mjs';
import { findOriginal } from './pipeline.mjs';

/**
 * @typedef {object} ProcessDeps
 * @property {import('./config.mjs').Paths} paths
 * @property {typeof import('sharp')} sharp
 * @property {(message: string) => void} log
 * @property {number} [tolerance]
 */

/**
 * @param {ProcessDeps} deps
 * @param {import('./config.mjs').Asset} asset
 * @returns {string} absolute path of the optimized file
 */
export function optimizedPath(deps, asset) {
  return path.join(deps.paths.optimizedDir, asset.optimized);
}

/**
 * Turn one original into its optimized file.
 *
 * @param {ProcessDeps} deps
 * @param {import('./config.mjs').Asset} asset
 * @returns {Promise<{ path: string, bytes: number, width: number, height: number }>}
 */
export async function processAsset(deps, asset) {
  const original = findOriginal(deps.paths, asset.name);
  if (!original) throw new CliError(`No original for "${asset.name}" — nothing to process (expected assets/original/${asset.name}.*).`);

  const target = optimizedPath(deps, asset);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const info = asset.kind === 'ship' ? await processShip(deps, asset, original, target) : await processScene(deps, asset, original, target);
  const bytes = fs.statSync(target).size;
  deps.log(`  ${asset.name} → src/assets/${asset.optimized} (${info.width}×${info.height}, ${bytes} bytes)`);
  return { path: target, bytes, width: info.width, height: info.height };
}

/**
 * Ships: cut the white background, trim to the hull, scale the long edge to
 * the Contract length, keep alpha.
 *
 * @param {ProcessDeps} deps
 * @param {import('./config.mjs').Asset} asset
 * @param {string} original
 * @param {string} target
 * @returns {Promise<{ width: number, height: number }>}
 */
async function processShip(deps, asset, original, target) {
  const { sharp } = deps;
  const { data, info } = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const cut = removeBackground(
    { data, width: info.width, height: info.height, channels: info.channels },
    { tolerance: deps.tolerance ?? BACKGROUND_TOLERANCE },
  );

  const longEdge = asset.longEdge ?? 640;
  const resize = cut.bounds.width >= cut.bounds.height ? { width: longEdge } : { height: longEdge };

  const result = await sharp(Buffer.from(cut.data), { raw: { width: cut.width, height: cut.height, channels: 4 } })
    .extract(cut.bounds)
    .resize({ ...resize, fit: 'inside' })
    .webp({ quality: asset.quality, alphaQuality: 100 })
    .toFile(target);

  const removedPercent = ((cut.removed / (cut.width * cut.height)) * 100).toFixed(1);
  deps.log(`  ${asset.name}: removed ${removedPercent}% as background, trimmed to ${cut.bounds.width}×${cut.bounds.height}`);
  return { width: result.width, height: result.height };
}

/**
 * Scenes: cover-crop to the Contract size — but NEVER upscale (DECISIONS D5:
 * the model returns ~1365×768 at "1k", and an upscaled background only costs
 * bytes in the single-file bundle).
 *
 * @param {ProcessDeps} deps
 * @param {import('./config.mjs').Asset} asset
 * @param {string} original
 * @param {string} target
 * @returns {Promise<{ width: number, height: number }>}
 */
async function processScene(deps, asset, original, target) {
  const { sharp } = deps;
  const wanted = { width: asset.width ?? 1600, height: asset.height ?? 900 };
  const meta = await sharp(original).metadata();
  const scale = Math.min(1, (meta.width ?? wanted.width) / wanted.width, (meta.height ?? wanted.height) / wanted.height);
  const width = Math.max(1, Math.round(wanted.width * scale));
  const height = Math.max(1, Math.round(wanted.height * scale));

  const result = await sharp(original)
    .resize(width, height, { fit: 'cover', position: 'centre', withoutEnlargement: true })
    .webp({ quality: asset.quality })
    .toFile(target);

  if (scale < 1) deps.log(`  ${asset.name}: capped at the original's ${meta.width}×${meta.height} (never upscaled)`);
  return { width: result.width, height: result.height };
}

/**
 * Process every asset that has an original; report the ones that do not.
 *
 * @param {ProcessDeps} deps
 * @param {readonly import('./config.mjs').Asset[]} assets
 * @returns {Promise<{ processed: string[], missing: string[] }>}
 */
export async function runProcess(deps, assets) {
  /** @type {string[]} */
  const processed = [];
  /** @type {string[]} */
  const missing = [];

  for (const asset of assets) {
    if (!findOriginal(deps.paths, asset.name)) {
      missing.push(asset.name);
      continue;
    }
    await processAsset(deps, asset);
    processed.push(asset.name);
  }

  deps.log(`Processed ${processed.length} asset(s).`);
  if (missing.length > 0) deps.log(`No original yet (not generated): ${missing.join(', ')}`);
  return { processed, missing };
}
