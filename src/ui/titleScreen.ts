/**
 * The title screen. It is a UI state, not an engine phase: the engine still
 * starts in `placement` and knows nothing about this screen (PLAN P11).
 * "Play again" and "New game" go back to placement, never to here.
 *
 * The one thing to decide here is who you are playing: the computer, or a
 * friend on another device (PLAN N6). Both choices sit on the title card, so
 * starting a game is still one click either way.
 */
import { TITLE_ART } from './assets';
import { COPY, GAME_TITLE } from './copy';
import { el } from './dom';

export interface TitleHandlers {
  onSolo: () => void;
  onOnline: () => void;
}

export class TitleScreen {
  readonly element: HTMLElement;

  private readonly solo: HTMLButtonElement;

  constructor(handlers: TitleHandlers) {
    this.element = el('div', 'screen screen--title');
    this.element.dataset['screen'] = 'title';

    const stack = el('div', 'title');

    const hero = el('figure', 'title__hero');
    // Decorative: the wordmark right underneath already says what this is.
    const art = el('img', 'title__art');
    art.src = TITLE_ART;
    art.alt = '';
    art.draggable = false;
    hero.append(art);

    const wordmark = el('h1', 'display title__wordmark', GAME_TITLE);
    const tagline = el('p', 'title__tagline', COPY.tagline);

    this.solo = choice('btn btn--primary', COPY.title.solo, 'btn-mode-solo', handlers.onSolo);
    const online = choice('btn', COPY.title.online, 'btn-mode-online', handlers.onOnline);

    const choices = el('div', 'title__choices');
    choices.append(this.solo, online);

    stack.append(hero, wordmark, tagline, choices);
    this.element.append(stack);
  }

  /** Enter plays the computer, because the focus lands on that button. */
  focusPlay(): void {
    this.solo.focus();
  }
}

function choice(
  className: string,
  label: string,
  testid: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = el('button', `${className} title__play`);
  button.type = 'button';
  button.textContent = label;
  button.dataset['testid'] = testid;
  button.addEventListener('click', onClick);
  return button;
}
