/** A row of small ship sprites; sunk ones are greyed out and struck through. */
import { FLEET } from '../engine/index';
import type { ShipId } from '../engine/index';
import { shipSprite } from './assets';
import { el, toggleAttr } from './dom';
import { COPY, titleCase } from './copy';

export class FleetStatus {
  readonly element: HTMLElement;

  private readonly items = new Map<ShipId, { root: HTMLElement; status: HTMLElement }>();

  constructor(title: string) {
    this.element = el('div', 'fleet');
    this.element.append(el('h3', 'eyebrow fleet__title', title));

    const list = el('ul', 'fleet__list');
    for (const spec of FLEET) {
      const item = el('li', 'fleet__item');
      item.dataset['sunk'] = 'false';
      const silhouette = el('span', 'fleet__silhouette');
      silhouette.style.setProperty('--len', String(spec.length));
      silhouette.append(shipSprite(spec.id, 'chip-sprite'));
      const name = el('span', 'fleet__name', titleCase(spec.name));
      const status = el('span', 'visually-hidden', COPY.fleet.afloat);
      item.append(silhouette, name, status);
      list.append(item);
      this.items.set(spec.id, { root: item, status });
    }
    this.element.append(list);
  }

  update(sunk: ReadonlySet<ShipId>): void {
    for (const [id, item] of this.items) {
      const isSunk = sunk.has(id);
      toggleAttr(item.root, 'data-sunk', isSunk ? 'true' : 'false');
      const text = isSunk ? COPY.fleet.sunk : COPY.fleet.afloat;
      if (item.status.textContent !== text) item.status.textContent = text;
    }
  }
}
