/**
 * `assets/manifest.json` — what was paid for, with which prompt and model.
 *
 * It is rewritten after EVERY asset (PLAN P5) so a crash halfway through a
 * paid run never loses the record of what has already been bought. It never
 * contains a credential: only the request body, which is prompt + style data.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} ManifestEntry
 * @property {string} name
 * @property {string} model
 * @property {Record<string, unknown>} body
 * @property {string} request_id
 * @property {string} created_at
 * @property {number} usd_estimate
 * @property {string} original   repo-relative path
 * @property {string | null} optimized repo-relative path
 * @property {number} bytes
 */

/** @typedef {{ version: number, updated_at: string | null, assets: Record<string, ManifestEntry> }} Manifest */

/**
 * @param {import('./config.mjs').Paths} paths
 * @returns {Manifest}
 */
export function readManifest(paths) {
  try {
    const parsed = JSON.parse(fs.readFileSync(paths.manifest, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.assets && typeof parsed.assets === 'object') {
      return { version: 1, updated_at: parsed.updated_at ?? null, assets: parsed.assets };
    }
  } catch {
    // no manifest yet, or an unreadable one: start a fresh record
  }
  return { version: 1, updated_at: null, assets: {} };
}

/**
 * @param {import('./config.mjs').Paths} paths
 * @param {Manifest} manifest
 */
export function writeManifest(paths, manifest) {
  fs.mkdirSync(path.dirname(paths.manifest), { recursive: true });
  fs.writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Merge one entry and flush immediately.
 *
 * @param {import('./config.mjs').Paths} paths
 * @param {ManifestEntry} entry
 * @param {() => string} [nowIso]
 * @returns {Manifest}
 */
export function writeManifestEntry(paths, entry, nowIso = () => new Date().toISOString()) {
  const manifest = readManifest(paths);
  manifest.assets[entry.name] = entry;
  manifest.updated_at = nowIso();
  writeManifest(paths, manifest);
  return manifest;
}

/**
 * @param {import('./config.mjs').Paths} paths
 * @param {string} absolutePath
 * @returns {string} a repo-relative path, with forward slashes
 */
export function relativeToRoot(paths, absolutePath) {
  return path.relative(paths.root, absolutePath).split(path.sep).join('/');
}
