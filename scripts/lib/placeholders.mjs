/**
 * `--placeholders`: locally drawn stand-in art so the UI (T5) can be built and
 * shipped before a single cent is spent.
 *
 * Rules: written into `src/assets/**` ONLY for names that have no optimized
 * file yet, never into `assets/original/**`. Dropping in the real art later is
 * therefore a no-code change — `--process` overwrites the same paths.
 */

import fs from 'node:fs';
import path from 'node:path';

import { optimizedPath } from './process.mjs';

const NAVY = '#174A7C';
const DEEP_NAVY = '#0B2A4A';
const HULL = '#8C97A3';
const DECK = '#6E7A88';
const RED = '#E0362C';
const YELLOW = '#F5B82E';
const OFF_WHITE = '#F6F4EE';

/**
 * @param {string} aspect e.g. "2:1"
 * @returns {number} width / height
 */
function aspectRatio(aspect) {
  const [w, h] = aspect.split(':').map(Number);
  return (w ?? 1) / (h ?? 1);
}

/**
 * The pixel size of a placeholder: ships keep their generated aspect at the
 * Contract long edge, scenes use the exact Contract size.
 *
 * @param {import('./config.mjs').Asset} asset
 * @returns {{ width: number, height: number }}
 */
export function placeholderSize(asset) {
  if (asset.kind === 'scene') return { width: asset.width ?? 1600, height: asset.height ?? 900 };
  const width = asset.longEdge ?? 640;
  return { width, height: Math.round(width / aspectRatio(asset.aspect)) };
}

/**
 * A top-down toy hull with the bow pointing RIGHT (Contract), on transparency.
 *
 * @param {import('./config.mjs').Asset} asset
 * @returns {string} SVG
 */
function shipSvg(asset) {
  const { width: w, height: h } = placeholderSize(asset);
  const cy = h / 2;
  const hh = h * 0.26; // half hull height
  const x0 = w * 0.03; // stern
  const xs = x0 + hh * 0.4; // where the rounded stern ends
  const xb = w * 0.58; // where the bow taper starts
  const xt = w * 0.985; // bow tip
  const xc = xb + (xt - xb) * 0.55; // taper control point — gives a pointed bow
  const stroke = Math.max(3, h * 0.035);

  const hull = [
    `M ${xs.toFixed(1)} ${(cy - hh).toFixed(1)}`,
    `L ${xb.toFixed(1)} ${(cy - hh).toFixed(1)}`,
    `Q ${xc.toFixed(1)} ${(cy - hh * 0.85).toFixed(1)} ${xt.toFixed(1)} ${cy.toFixed(1)}`,
    `Q ${xc.toFixed(1)} ${(cy + hh * 0.85).toFixed(1)} ${xb.toFixed(1)} ${(cy + hh).toFixed(1)}`,
    `L ${xs.toFixed(1)} ${(cy + hh).toFixed(1)}`,
    `Q ${x0.toFixed(1)} ${(cy + hh).toFixed(1)} ${x0.toFixed(1)} ${cy.toFixed(1)}`,
    `Q ${x0.toFixed(1)} ${(cy - hh).toFixed(1)} ${xs.toFixed(1)} ${(cy - hh).toFixed(1)}`,
    'Z',
  ].join(' ');

  const deckX = w * 0.1;
  const deckW = w * 0.42;
  const deckH = hh * 1.05;
  const fontSize = Math.max(10, h * 0.2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <path d="${hull}" fill="${HULL}" stroke="${NAVY}" stroke-width="${stroke.toFixed(1)}" stroke-linejoin="round"/>
  <rect x="${deckX.toFixed(1)}" y="${(cy - deckH / 2).toFixed(1)}" width="${deckW.toFixed(1)}" height="${deckH.toFixed(1)}" rx="${(deckH * 0.3).toFixed(1)}" fill="${DECK}"/>
  <rect x="${(w * 0.56).toFixed(1)}" y="${(cy - hh * 0.4).toFixed(1)}" width="${(w * 0.07).toFixed(1)}" height="${(hh * 0.8).toFixed(1)}" rx="${(hh * 0.22).toFixed(1)}" fill="${YELLOW}"/>
  <circle cx="${(w * 0.72).toFixed(1)}" cy="${cy.toFixed(1)}" r="${(hh * 0.26).toFixed(1)}" fill="${RED}"/>
  <text x="${(deckX + deckW / 2).toFixed(1)}" y="${(cy + fontSize * 0.35).toFixed(1)}" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize.toFixed(1)}" font-weight="bold" fill="${OFF_WHITE}" text-anchor="middle">${asset.label}</text>
</svg>`;
}

/** @type {Record<string, { background: string, ink: string, accent: string }>} */
const SCENE_STYLE = {
  table: { background: '#DEC49C', ink: '#7A5A32', accent: '#C9AA7E' },
  title: { background: NAVY, ink: OFF_WHITE, accent: '#2E6FA8' },
  victory: { background: YELLOW, ink: DEEP_NAVY, accent: '#E8A81F' },
  defeat: { background: '#5A6B7C', ink: OFF_WHITE, accent: '#4A5866' },
};

/**
 * A flat, clearly-labelled colour field — enough for layout work, obviously
 * not final art.
 *
 * @param {import('./config.mjs').Asset} asset
 * @returns {string} SVG
 */
function sceneSvg(asset) {
  const { width: w, height: h } = placeholderSize(asset);
  const style = SCENE_STYLE[asset.name] ?? { background: NAVY, ink: OFF_WHITE, accent: '#2E6FA8' };
  const title = Math.round(h * 0.12);
  const subtitle = Math.round(h * 0.05);

  // A few soft stripes keep the field from looking like a broken image.
  const stripes = Array.from({ length: 6 }, (_, i) => {
    const y = ((i + 0.5) * h) / 6;
    return `<rect x="0" y="${(y - h * 0.012).toFixed(1)}" width="${w}" height="${(h * 0.024).toFixed(1)}" fill="${style.accent}"/>`;
  }).join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${style.background}"/>
  ${stripes}
  <text x="${w / 2}" y="${(h / 2).toFixed(1)}" font-family="Helvetica, Arial, sans-serif" font-size="${title}" font-weight="bold" fill="${style.ink}" text-anchor="middle">${asset.label}</text>
  <text x="${w / 2}" y="${(h / 2 + title * 0.9).toFixed(1)}" font-family="Helvetica, Arial, sans-serif" font-size="${subtitle}" fill="${style.ink}" text-anchor="middle" opacity="0.8">placeholder art — ${w}×${h}</text>
</svg>`;
}

/**
 * @param {import('./config.mjs').Asset} asset
 * @returns {string} SVG
 */
export function placeholderSvg(asset) {
  return asset.kind === 'ship' ? shipSvg(asset) : sceneSvg(asset);
}

/**
 * Write placeholders for the assets that have no optimized file yet.
 *
 * @param {import('./process.mjs').ProcessDeps & { force?: boolean }} deps
 * @param {readonly import('./config.mjs').Asset[]} assets
 * @returns {Promise<{ written: string[], skipped: string[] }>}
 */
export async function runPlaceholders(deps, assets) {
  /** @type {string[]} */
  const written = [];
  /** @type {string[]} */
  const skipped = [];

  for (const asset of assets) {
    const target = optimizedPath(deps, asset);
    if (!deps.force && fs.existsSync(target)) {
      skipped.push(asset.name);
      continue;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    const svg = placeholderSvg(asset);
    const image = deps.sharp(Buffer.from(svg));
    const result = await (asset.kind === 'ship'
      ? image.webp({ quality: asset.quality, alphaQuality: 100 })
      : image.flatten({ background: '#ffffff' }).webp({ quality: asset.quality })
    ).toFile(target);

    written.push(asset.name);
    deps.log(`  ${asset.name} → src/assets/${asset.optimized} (${result.width}×${result.height}, ${result.size} bytes)`);
  }

  deps.log(`Placeholders: wrote ${written.length}, left ${skipped.length} existing file(s) untouched.`);
  if (skipped.length > 0) deps.log(`  already present: ${skipped.join(', ')}`);
  return { written, skipped };
}
