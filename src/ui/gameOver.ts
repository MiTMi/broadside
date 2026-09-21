/** The end-of-game card: the outcome art, one big stencil word, the numbers, and Play again. */
import { DEFEAT_ART, VICTORY_ART, VICTORY_VIDEO } from './assets';
import { COPY } from './copy';
import { el, setText } from './dom';

export interface GameOverProps {
  won: boolean;
  detail: string;
  /** Play the victory clip before revealing the card (wins only). */
  video?: boolean;
  /** Start the clip without sound (the game is muted). */
  muted?: boolean;
  /** Called once, when the card itself becomes visible. */
  onReveal?: () => void;
}

export class GameOverDialog {
  readonly element: HTMLDialogElement;

  private readonly art: HTMLImageElement;
  private readonly stage: HTMLElement;
  private readonly video: HTMLVideoElement;
  private readonly skip: HTMLButtonElement;
  private readonly body: HTMLElement;
  private readonly again: HTMLButtonElement;
  private reveal: (() => void) | null = null;
  private readonly word: HTMLElement;
  private readonly detail: HTMLElement;

  constructor(onPlayAgain: () => void) {
    this.element = el('dialog', 'modal modal--result');
    const card = el('div', 'modal__card');

    // Decorative: the heading right below it states the result in words.
    this.art = el('img', 'modal__art');
    this.art.alt = '';
    this.art.draggable = false;
    this.art.dataset['testid'] = 'result-art';

    this.word = el('p', 'display modal__word');
    this.word.dataset['testid'] = 'result';
    this.detail = el('p', 'modal__detail');

    const again = el('button', 'btn btn--primary');
    again.type = 'button';
    again.textContent = COPY.over.playAgain;
    again.dataset['testid'] = 'btn-play-again';
    again.addEventListener('click', onPlayAgain);

    this.again = again;
    this.body = el('div', 'modal__body');
    this.body.append(this.art, this.word, this.detail, again);

    // The victory clip: plays first, then (or on Skip) the card takes over.
    this.video = el('video', 'modal__video');
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.dataset['testid'] = 'victory-video';
    this.video.setAttribute('aria-label', COPY.over.victory);
    this.skip = el('button', 'btn btn--quiet modal__skip');
    this.skip.type = 'button';
    this.skip.textContent = COPY.over.skipVideo;
    this.skip.dataset['testid'] = 'btn-skip-video';
    this.stage = el('div', 'modal__stage');
    this.stage.append(this.video, this.skip);
    this.stage.hidden = true;

    const finish = (): void => this.reveal?.();
    this.skip.addEventListener('click', finish);
    this.video.addEventListener('ended', finish);
    this.video.addEventListener('error', finish);

    card.append(this.stage, this.body);
    this.element.append(card);
    // The result is not dismissible: the only way on is "Play again".
    this.element.addEventListener('cancel', (event) => event.preventDefault());
  }

  show(props: GameOverProps): void {
    const src = props.won ? VICTORY_ART : DEFEAT_ART;
    if (this.art.getAttribute('src') !== src) this.art.src = src;
    setText(this.word, props.won ? COPY.over.victory : COPY.over.defeat);
    this.word.dataset['outcome'] = props.won ? 'victory' : 'defeat';
    setText(this.detail, props.detail);

    const showCard = (): void => {
      if (this.reveal === null) return;
      this.reveal = null;
      this.video.pause();
      this.stage.hidden = true;
      this.body.hidden = false;
      this.element.dataset['stage'] = 'card';
      this.again.focus();
      props.onReveal?.();
    };
    this.reveal = showCard;

    const playClip = props.won && props.video === true;
    this.stage.hidden = !playClip;
    this.body.hidden = playClip;
    this.element.dataset['stage'] = playClip ? 'video' : 'card';
    if (!this.element.open) this.element.showModal();

    if (!playClip) {
      showCard();
      return;
    }
    if (this.video.getAttribute('src') !== VICTORY_VIDEO) this.video.src = VICTORY_VIDEO;
    this.video.currentTime = 0;
    this.video.muted = props.muted === true;
    this.video.volume = 0.85;
    this.skip.focus();
    // Browsers may refuse un-muted autoplay; a silent clip beats no clip, and no clip beats a stuck dialog.
    void this.video.play().catch(() => {
      this.video.muted = true;
      return this.video.play().catch(showCard);
    });
  }

  close(): void {
    this.reveal = null;
    this.video.pause();
    if (this.element.open) this.element.close();
  }
}
