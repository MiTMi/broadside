/** The last few shots, newest first, mirrored into a polite live region. */
import { el } from './dom';
import { COPY } from './copy';

const VISIBLE = 4;

export class BattleLog {
  readonly element: HTMLElement;

  private readonly list: HTMLOListElement;
  private readonly live: HTMLElement;
  private announced = 0;

  constructor() {
    this.element = el('section', 'log panel');
    this.element.append(el('h3', 'eyebrow', COPY.battle.log));
    this.list = el('ol', 'log__list');
    this.live = el('p', 'visually-hidden');
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'polite');
    this.element.append(this.list, this.live);
  }

  update(entries: readonly string[]): void {
    const recent = entries.slice(-VISIBLE).reverse();
    this.list.replaceChildren(
      ...recent.map((text, index) => {
        const line = el('li', 'log__line mono', text);
        line.dataset['age'] = String(index);
        return line;
      }),
    );

    // A sinking shot adds two lines at once: announce everything that is new,
    // so "D4 — hit." is not swallowed by "You sank the enemy cruiser."
    if (entries.length < this.announced) this.announced = 0;
    if (entries.length > this.announced) {
      this.live.textContent = entries.slice(this.announced).join(' ');
      this.announced = entries.length;
    }
  }
}
