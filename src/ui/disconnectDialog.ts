/**
 * What happened when an online game stopped without finishing: the opponent
 * left, the connection dropped, the room was full (Decision N7/N9, D10). One
 * modal, one way on — back to the title. Never a stuck spinner.
 */
import type { MatchEnd } from '../match/index';
import { COPY } from './copy';
import { el, setText } from './dom';

export class DisconnectDialog {
  readonly element: HTMLDialogElement;

  private readonly title: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly back: HTMLButtonElement;
  private shown: MatchEnd | null = null;

  constructor(onBack: () => void) {
    this.element = el('dialog', 'modal modal--disconnect');
    this.element.dataset['testid'] = 'disconnect';

    const card = el('div', 'modal__card');
    this.title = el('h2', 'heading');
    this.title.dataset['testid'] = 'disconnect-title';
    this.detail = el('p', 'modal__detail');

    this.back = el('button', 'btn btn--primary');
    this.back.type = 'button';
    this.back.textContent = COPY.online.backToTitle;
    this.back.dataset['testid'] = 'btn-back-title';
    this.back.addEventListener('click', onBack);

    const row = el('div', 'modal__actions');
    row.append(this.back);
    card.append(this.title, this.detail, row);
    this.element.append(card);
    // Escape would leave the player looking at a game that cannot go on.
    this.element.addEventListener('cancel', (event) => event.preventDefault());
  }

  /** Idempotent: re-rendering the same reason must not re-steal the focus. */
  show(end: MatchEnd): void {
    if (this.shown === end && this.element.open) return;
    this.shown = end;
    const copy = COPY.online.ended[end];
    setText(this.title, copy.title);
    setText(this.detail, copy.detail);
    if (!this.element.open) this.element.showModal();
    this.back.focus();
  }

  close(): void {
    this.shown = null;
    if (this.element.open) this.element.close();
  }
}
