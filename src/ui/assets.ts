/**
 * The ONLY module in the game that imports image files. Everything else asks
 * for a URL here, so the art can be regenerated, renamed or re-optimised in one
 * place. The single-file build inlines each of these as a `data:` URI, which is
 * also why the list is short and deliberate.
 *
 * Ship sprites are trimmed to their content and drawn bow-right; the board
 * rotates the same file for vertical ships (see `.hull--v` in board.css).
 */
import type { ShipId } from '../engine/index';
import { el } from './dom';

import battleship from '../assets/ships/battleship.webp';
import carrier from '../assets/ships/carrier.webp';
import corvette from '../assets/ships/corvette.webp';
import cruiser from '../assets/ships/cruiser.webp';
import destroyer from '../assets/ships/destroyer.webp';
import frigate from '../assets/ships/frigate.webp';
import patrol from '../assets/ships/patrol.webp';
import submarine from '../assets/ships/submarine.webp';

import defeat from '../assets/defeat.webp';
import table from '../assets/table.webp';
import title from '../assets/title.webp';
import victory from '../assets/victory.webp';
import victoryVideo from '../assets/victory.mp4';

/** One sprite per ship, keyed by the engine's `ShipId`. */
export const SHIP_SPRITES: Record<ShipId, string> = {
  carrier,
  battleship,
  cruiser,
  submarine,
  frigate,
  destroyer,
  corvette,
  patrol,
};

/** The realistic "enemy ship destroyed" clip played before the Victory card (generated once, see scripts/generate-video.mjs). */
export const VICTORY_VIDEO = victoryVideo;

/** The tabletop the whole page sits on. */
export const TABLE_BG = table;

/** Hero image on the title screen. */
export const TITLE_ART = title;

/** Result card, one per outcome. */
export const VICTORY_ART = victory;
export const DEFEAT_ART = defeat;

/**
 * A ship sprite as a decorative `<img>`. Always `alt=""`: wherever a sprite
 * appears the ship is already named in text or in an `aria-label`, and
 * `draggable=false` keeps a sprite inside a button from starting a drag.
 */
export function shipSprite(id: ShipId, className: string): HTMLImageElement {
  const img = el('img', className);
  img.src = SHIP_SPRITES[id];
  img.alt = '';
  img.draggable = false;
  return img;
}
