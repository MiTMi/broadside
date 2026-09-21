/**
 * The title screen. It is a UI state, not an engine phase: the engine still
 * starts in `placement` and knows nothing about this screen (PLAN P11).
 * "Play again" and "New game" go back to placement, never to here.
 */
import { TITLE_ART } from './assets';
import { COPY, GAME_TITLE } from './copy';
import { el } from './dom';

export class TitleScreen {
  readonly element: HTMLElement;

  private readonly play: HTMLButtonElement;

  constructor(onPlay: () => void) {
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

    this.play = el('button', 'btn btn--primary title__play');
    this.play.type = 'button';
    this.play.textContent = COPY.title.play;
    this.play.dataset['testid'] = 'btn-play';
    this.play.addEventListener('click', onPlay);

    stack.append(hero, wordmark, tagline, this.play);
    this.element.append(stack);
  }

  /** Enter starts the game because the focus lands on the primary button. */
  focusPlay(): void {
    this.play.focus();
  }
}
