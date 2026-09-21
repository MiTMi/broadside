/**
 * The single source of truth for the asset pipeline: the 12-asset Contract
 * table, the verbatim prompts, the model config (path + body builder) and the
 * paths on disk.
 *
 * PLAN Contracts → "Asset table" / "Prompts"; model per DECISIONS D5.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_BASE = 'https://api.higgsfield.ai';

/** Project root, derived from this file's location (scripts/lib → ..). */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @typedef {{ root: string, originalDir: string, replacedDir: string, optimizedDir: string, manifest: string }} Paths
 */

/**
 * @param {string} [root]
 * @returns {Paths}
 */
export function createPaths(root = PROJECT_ROOT) {
  const originalDir = path.join(root, 'assets', 'original');
  return {
    root,
    originalDir,
    replacedDir: path.join(originalDir, '.replaced'),
    optimizedDir: path.join(root, 'src', 'assets'),
    manifest: path.join(root, 'assets', 'manifest.json'),
  };
}

// ---------------------------------------------------------------------------
// Prompts — copied verbatim from PLAN.md (the plan wraps them for readability;
// wrapped lines are joined with a single space, nothing else is changed).
// ---------------------------------------------------------------------------

// Revised after the first real generation came back as a 3/4 side view: the
// camera angle now leads the prompt and every wrong angle is named explicitly.
// Sprites are rotated 90° in CSS for vertical ships, so a true plan view is a
// hard requirement, not a stylistic preference.
export const STYLE_SHIP =
  "Top-down plan view game sprite of a toy warship, seen from directly overhead like a satellite photo or a map icon, camera pointing straight down at the deck. Only the deck is visible from above; the sides of the hull are not visible at all; no horizon, no three-quarter view, no side view, no perspective. The outline is a simple symmetrical elongated boat shape lying perfectly horizontal: pointed bow on the right, flat stern on the left, mirror-symmetrical about its horizontal centre line, spanning almost the full width of the frame and centered. Cute playful children's board game cartoon style: chunky rounded shapes, thick dark navy outline around the entire silhouette, flat cel-shaded colours, light battleship-grey deck with a slightly darker grey border, small bright red and yellow accents, one soft white highlight. Very simple, few details, crisp clean silhouette. Isolated on a pure white background. No water, no waves, no wake, no drop shadow, no text, no numbers, no letters, no border.";

export const STYLE_SCENE =
  'Bright playful cartoon illustration in the style of a modern children\'s board game box cover. Bold clean outlines, chunky rounded shapes, flat cel-shaded colours, cheerful and friendly. Palette: deep navy and bright blue sea, light sky blue, battleship greys, accents of sunny yellow and warm red, white clouds. Simple bold composition. No text, no letters, no numbers, no logos, no border, no frame.';

// ---------------------------------------------------------------------------
// Palettes (DECISIONS D5) — sent to the model as `colors` / `background_color`.
// ---------------------------------------------------------------------------

/** @typedef {{ rgb: [number, number, number] }} RgbColor */

/** @type {RgbColor[]} */
export const GAME_PALETTE = [
  { rgb: [23, 74, 124] }, // navy
  { rgb: [140, 151, 163] }, // hull grey
  { rgb: [224, 54, 44] }, // peg red
  { rgb: [245, 184, 46] }, // signal yellow
  { rgb: [246, 244, 238] }, // white
];

/** @type {RgbColor[]} */
export const WOOD_PALETTE = [{ rgb: [222, 196, 156] }, { rgb: [201, 170, 126] }, { rgb: [240, 224, 196] }];

/** @type {RgbColor} */
const WHITE_BACKGROUND = { rgb: [255, 255, 255] };

// ---------------------------------------------------------------------------
// Asset table — the Contract between T4, T5 and the generation run.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Asset
 * @property {string} name
 * @property {'ship' | 'scene'} kind
 * @property {string} aspect                     aspect_ratio sent to the model
 * @property {string} prompt                     verbatim prompt
 * @property {RgbColor[]} colors
 * @property {RgbColor} [backgroundColor]
 * @property {string} optimized                  path relative to src/assets
 * @property {string} label                      placeholder label
 * @property {number} [longEdge]                 ships: optimized long side in px
 * @property {number} [width]                    scenes: optimized width in px
 * @property {number} [height]                   scenes: optimized height in px
 * @property {number} quality                    WebP quality
 */

/**
 * @param {string} name
 * @param {string} detail appended verbatim to STYLE_SHIP (keeps its leading space)
 * @param {number} longEdge
 * @returns {Asset}
 */
function ship(name, detail, longEdge) {
  return {
    name: `ship-${name}`,
    kind: 'ship',
    // D5: the model's aspect enum has no 21:9; every ship is generated at 2:1.
    aspect: '2:1',
    prompt: STYLE_SHIP + detail,
    colors: GAME_PALETTE,
    backgroundColor: WHITE_BACKGROUND,
    optimized: `ships/${name}.webp`,
    label: name.toUpperCase(),
    longEdge,
    quality: 82,
  };
}

/** @type {readonly Asset[]} */
export const ASSETS = [
  ship(
    'carrier',
    ' From above it is an aircraft carrier: a long flat rectangular flight deck with a pale painted runway centre line and a small square island tower on one edge.',
    640,
  ),
  ship(
    'battleship',
    ' From above it is a battleship: broad deck tapering to a pointed bow, round gun turrets seen as circles with short barrels pointing toward the bow, two forward and one aft, a blocky superstructure in the middle.',
    640,
  ),
  ship(
    'cruiser',
    ' From above it is a cruiser: a slim deck with a pointed bow, one round twin-gun turret forward and one aft, a single round funnel in the middle.',
    640,
  ),
  ship(
    'submarine',
    ' From above it is a submarine: a smooth cigar-shaped dark grey hull with a rounded bow, a small oval conning tower in the middle, small tail fins at the stern, no guns.',
    640,
  ),
  ship(
    'frigate',
    ' From above it is a frigate: a slim deck with a sharp bow, one small round gun forward, a boxy bridge, and a helicopter landing pad at the stern marked with a plain painted circle ring, no letters.',
    640,
  ),
  ship(
    'destroyer',
    ' From above it is a short stubby destroyer: a compact deck, sharp bow, one round gun turret forward, one round funnel.',
    480,
  ),
  ship(
    'corvette',
    ' From above it is a short stubby corvette: a compact deck with a rounded stern, a small bridge in the middle, a tiny round gun at the bow.',
    480,
  ),
  ship(
    'patrol',
    ' From above it is a small patrol boat: a short wide deck with a pointed bow, an open rear deck, a small cabin toward the front.',
    480,
  ),
  {
    name: 'table',
    kind: 'scene',
    aspect: '16:9',
    prompt:
      'Top-down cartoon illustration of a light wooden tabletop, playful children\'s game style: wide pale honey-coloured planks running horizontally with simple stylised wood grain lines and a few knots, flat cel-shaded colours, soft and low contrast, very even lighting, completely empty surface, no objects, no vignette, no shadows, no text, uniform texture filling the whole frame.',
    colors: WOOD_PALETTE,
    optimized: 'table.webp',
    label: 'TABLE',
    width: 1600,
    height: 900,
    quality: 68,
  },
  {
    name: 'title',
    kind: 'scene',
    aspect: '16:9',
    prompt:
      STYLE_SCENE +
      " A chunky friendly grey cartoon battleship seen from a low three-quarter angle, bouncing through big rounded navy waves toward the viewer's right, firing a broadside: a row of cannons with star-shaped yellow-and-red cartoon muzzle flashes and round puffy white smoke clouds. Two small cute escort ships on the horizon. Large calm area of light blue sky with a few puffy clouds in the upper third of the image.",
    colors: GAME_PALETTE,
    optimized: 'title.webp',
    label: 'TITLE',
    width: 1600,
    height: 900,
    quality: 76,
  },
  {
    name: 'victory',
    kind: 'scene',
    aspect: '4:3',
    prompt:
      STYLE_SCENE +
      ' Victory celebration at sea: a proud chunky grey cartoon battleship in calm sparkling blue water, seen from the side, colourful yellow and red bunting flags strung from bow to mast to stern, tiny simple cheering sailor figures on deck throwing their caps in the air, confetti, a big sunny yellow sun with flat rays behind, happy seagulls. Triumphant, joyful mood.',
    colors: GAME_PALETTE,
    optimized: 'victory.webp',
    label: 'VICTORY',
    width: 1000,
    height: 750,
    quality: 76,
  },
  {
    name: 'defeat',
    kind: 'scene',
    aspect: '4:3',
    prompt:
      STYLE_SCENE +
      ' Gentle comedic defeat at sea: a chunky grey cartoon battleship tilted and half sunk in navy water with its bow pointing up, big round bubbles and a few puffs of grey smoke, tiny simple sailor figures sitting safely in a small yellow life raft nearby looking glum, one waving a little white flag, overcast blue-grey sky with a single rain cloud. Light-hearted, not scary, nobody hurt.',
    colors: GAME_PALETTE,
    optimized: 'defeat.webp',
    label: 'DEFEAT',
    width: 1000,
    height: 750,
    quality: 76,
  },
];

/**
 * @param {readonly string[]} names
 * @returns {Asset[]}
 * @throws {Error} on an unknown name (the caller turns this into a CliError).
 */
export function selectAssets(names) {
  if (names.length === 0) return [...ASSETS];
  return names.map((name) => {
    const asset = ASSETS.find((a) => a.name === name);
    if (!asset) throw new Error(`Unknown asset "${name}". Known names: ${ASSETS.map((a) => a.name).join(', ')}`);
    return asset;
  });
}

// ---------------------------------------------------------------------------
// Models — path + body builder in ONE object so switching is a one-line change
// (PLAN P4). Candidates and the chosen default come from DECISIONS D5.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Model
 * @property {string} path
 * @property {string} note
 * @property {(asset: Asset) => Record<string, unknown>} buildBody
 */

/** Recraft (chosen, D5): illustration-native; unknown fields are ignored, so send only the schema's fields. */
/** @type {(asset: Asset) => Record<string, unknown>} */
const recraftBody = (asset) => ({
  prompt: asset.prompt,
  aspect_ratio: asset.aspect,
  resolution: '1k',
  ...(asset.backgroundColor ? { background_color: asset.backgroundColor } : {}),
  colors: asset.colors,
});

/** Higgsfield Soul: different schema (num_images / 720p|1080p resolution). */
/** @type {(asset: Asset) => Record<string, unknown>} */
const soulBody = (asset) => ({
  prompt: asset.prompt,
  aspect_ratio: asset.aspect,
  resolution: '1080p',
  num_images: 1,
});

/** Models whose schema we have not verified: prompt + aspect only. */
/** @type {(asset: Asset) => Record<string, unknown>} */
const genericBody = (asset) => ({ prompt: asset.prompt, aspect_ratio: asset.aspect });

/** @type {Record<string, Model>} */
export const MODELS = {
  'recraft/v4.1/text-to-image': { path: 'recraft/v4.1/text-to-image', note: 'chosen (D5) — $0.035', buildBody: recraftBody },
  'recraft/v4.1/utility/text-to-image': {
    path: 'recraft/v4.1/utility/text-to-image',
    note: '$0.035',
    buildBody: recraftBody,
  },
  'recraft/v4.1/pro/text-to-image': { path: 'recraft/v4.1/pro/text-to-image', note: '$0.21', buildBody: recraftBody },
  'ideogram/v4.0': { path: 'ideogram/v4.0', note: '$0.06', buildBody: genericBody },
  'alibaba/qwen-image-3/text-to-image': {
    path: 'alibaba/qwen-image-3/text-to-image',
    note: '$0.04',
    buildBody: genericBody,
  },
  'z-image/turbo': { path: 'z-image/turbo', note: '$0.015', buildBody: genericBody },
  'higgsfield-ai/soul/v2/standard': {
    path: 'higgsfield-ai/soul/v2/standard',
    note: '$0.004 — photoreal-oriented',
    buildBody: soulBody,
  },
  'higgsfield-ai/soul/standard': { path: 'higgsfield-ai/soul/standard', note: '$0.094', buildBody: soulBody },
};

export const DEFAULT_MODEL = 'recraft/v4.1/text-to-image';

/** Candidate paths for `--probe` (free estimate calls only). */
export const PROBE_MODELS = Object.keys(MODELS);

/** A tiny throw-away asset used to shape `--probe`'s estimate bodies. */
/** @type {Asset} */
export const PROBE_ASSET = {
  name: 'probe',
  kind: 'scene',
  aspect: '1:1',
  prompt: 'a red circle on a white background',
  colors: GAME_PALETTE,
  optimized: 'probe.webp',
  label: 'PROBE',
  width: 64,
  height: 64,
  quality: 80,
};

/**
 * @param {string} modelPath
 * @returns {Model} an unknown path still works — it falls back to the generic body.
 */
export function getModel(modelPath) {
  return MODELS[modelPath] ?? { path: modelPath, note: 'unverified schema', buildBody: genericBody };
}

/** Defaults for the spend guards (PLAN P5). */
export const DEFAULT_MAX_USD = 3.0;
export const POLL_INTERVAL_MS = 3_000;
export const POLL_TIMEOUT_MS = 5 * 60_000;

/** Background removal defaults (PLAN P6). */
export const BACKGROUND_TOLERANCE = 0.12;
