/**
 * The Contract itself: the 12 asset names and sizes T5 and the generation run
 * depend on, the verbatim prompts, and the model body shape from DECISIONS D5.
 *
 * The plan wraps the prompts across lines for readability; these tests are how
 * "verbatim" is proved — no stray newlines, no double spaces, every prompt
 * built from the exact STYLE string.
 */

import { describe, expect, it } from 'vitest';

import {
  ASSETS,
  DEFAULT_MAX_USD,
  DEFAULT_MODEL,
  MODELS,
  PROBE_MODELS,
  STYLE_SCENE,
  STYLE_SHIP,
  getModel,
  selectAssets,
} from '../../scripts/lib/config.mjs';

const SHIP_NAMES = [
  'ship-carrier',
  'ship-battleship',
  'ship-cruiser',
  'ship-submarine',
  'ship-frigate',
  'ship-destroyer',
  'ship-corvette',
  'ship-patrol',
];

describe('the asset Contract', () => {
  it('has exactly the 12 agreed names', () => {
    expect(ASSETS.map((a) => a.name)).toEqual([...SHIP_NAMES, 'table', 'title', 'victory', 'defeat']);
  });

  it('maps each asset to the agreed optimized file and size', () => {
    const byName = Object.fromEntries(ASSETS.map((a) => [a.name, a]));
    expect(byName['ship-carrier']).toMatchObject({ optimized: 'ships/carrier.webp', longEdge: 640 });
    expect(byName['ship-destroyer']).toMatchObject({ optimized: 'ships/destroyer.webp', longEdge: 480 });
    expect(byName['ship-corvette']?.longEdge).toBe(480);
    expect(byName['ship-patrol']?.longEdge).toBe(480);
    expect(byName['table']).toMatchObject({ optimized: 'table.webp', width: 1600, height: 900, quality: 68 });
    expect(byName['title']).toMatchObject({ optimized: 'title.webp', width: 1600, height: 900, quality: 76 });
    expect(byName['victory']).toMatchObject({ optimized: 'victory.webp', width: 1000, height: 750, quality: 76 });
    expect(byName['defeat']).toMatchObject({ optimized: 'defeat.webp', width: 1000, height: 750, quality: 76 });
  });

  it('uses the aspect ratios the chosen model actually offers (D5)', () => {
    for (const asset of ASSETS) {
      const expected = asset.kind === 'ship' ? '2:1' : asset.name === 'victory' || asset.name === 'defeat' ? '4:3' : '16:9';
      expect(asset.aspect, asset.name).toBe(expected);
    }
  });

  it('selects by name and rejects unknown names', () => {
    expect(selectAssets([]).length).toBe(12);
    expect(selectAssets(['table']).map((a) => a.name)).toEqual(['table']);
    expect(() => selectAssets(['ship-dinghy'])).toThrow(/Unknown asset/);
  });
});

describe('the prompts', () => {
  it('prepends the STYLE strings verbatim', () => {
    for (const asset of ASSETS) {
      if (asset.kind === 'ship') {
        expect(asset.prompt.startsWith(STYLE_SHIP), asset.name).toBe(true);
        expect(asset.prompt.slice(STYLE_SHIP.length).startsWith(' From above it is '), asset.name).toBe(true);
      } else if (asset.name !== 'table') {
        expect(asset.prompt.startsWith(STYLE_SCENE), asset.name).toBe(true);
      }
    }
    // The table prompt is standalone in the plan — no STYLE prefix.
    expect(ASSETS.find((a) => a.name === 'table')?.prompt.startsWith('Top-down cartoon illustration')).toBe(true);
  });

  it('carries no line breaks or doubled spaces from the plan\'s wrapping', () => {
    for (const asset of ASSETS) {
      expect(asset.prompt, asset.name).not.toMatch(/[\n\r\t]/);
      expect(asset.prompt, asset.name).not.toMatch(/ {2}/);
      expect(asset.prompt.trim()).toBe(asset.prompt);
    }
  });

  it('keeps the art direction that the sprites depend on', () => {
    // Vertical ships are the same file rotated 90°, so a true plan view and a
    // bow on the right are load-bearing, not decorative.
    expect(STYLE_SHIP.startsWith('Top-down plan view')).toBe(true);
    expect(STYLE_SHIP).toContain('pointed bow on the right');
    expect(STYLE_SHIP).toContain('camera pointing straight down at the deck');
    expect(STYLE_SHIP).toContain('Isolated on a pure white background');
    expect(STYLE_SHIP).toContain('no text');
    expect(STYLE_SCENE).toContain('No text, no letters, no numbers');
  });

  it('rules out every wrong camera angle by name (the first real ship came back as a side view)', () => {
    for (const phrase of ['no horizon', 'no three-quarter view', 'no side view', 'no perspective']) {
      expect(STYLE_SHIP, phrase).toContain(phrase);
    }
    expect(STYLE_SHIP).toContain('the sides of the hull are not visible at all');
  });

  it('describes every ship from above and asks for no lettering', () => {
    for (const asset of ASSETS.filter((a) => a.kind === 'ship')) {
      expect(asset.prompt, asset.name).toContain('From above it is');
    }
    // The helipad must not become a painted "H" — models garble letters.
    expect(ASSETS.find((a) => a.name === 'ship-frigate')?.prompt).toContain('no letters');
  });
});

describe('the model config', () => {
  it('defaults to the model the orchestrator verified (D5)', () => {
    expect(DEFAULT_MODEL).toBe('recraft/v4.1/text-to-image');
    expect(PROBE_MODELS).toContain(DEFAULT_MODEL);
    expect(PROBE_MODELS.length).toBe(Object.keys(MODELS).length);
    expect(PROBE_MODELS).not.toContain('flux-pro/kontext/max/text-to-image'); // 404 on this account
  });

  it('builds exactly the body the chosen model accepts', () => {
    const model = getModel(DEFAULT_MODEL);
    const carrier = ASSETS[0];
    const body = model.buildBody(/** @type {never} */ (carrier));

    expect(Object.keys(body).sort()).toEqual(['aspect_ratio', 'background_color', 'colors', 'prompt', 'resolution']);
    expect(body['resolution']).toBe('1k');
    expect(body['aspect_ratio']).toBe('2:1');
    expect(body['background_color']).toEqual({ rgb: [255, 255, 255] });
    expect(body['colors']).toHaveLength(5);
    expect(body).not.toHaveProperty('num_images');
    expect(body).not.toHaveProperty('seed');
    expect(body).not.toHaveProperty('safety_tolerance');
  });

  it('sends wood tones for the table and no background colour for scenes', () => {
    const model = getModel(DEFAULT_MODEL);
    const table = ASSETS.find((a) => a.name === 'table');
    const body = model.buildBody(/** @type {never} */ (table));

    expect(body).not.toHaveProperty('background_color');
    expect(body['colors']).toEqual([{ rgb: [222, 196, 156] }, { rgb: [201, 170, 126] }, { rgb: [240, 224, 196] }]);
  });

  it('falls back to a minimal body for an unverified --model override', () => {
    const body = getModel('some/new/model').buildBody(/** @type {never} */ (ASSETS[0]));
    expect(Object.keys(body).sort()).toEqual(['aspect_ratio', 'prompt']);
  });

  it('keeps the default spend cap at $3.00', () => {
    expect(DEFAULT_MAX_USD).toBe(3);
  });
});
