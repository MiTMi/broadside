/**
 * The online lobby: create a game and hand out the code, or join one with a
 * code someone read out to you (Decision N8). One screen, so either way is a
 * single click away; the state decides which half of it is on show.
 *
 * The screen owns the code input and its validation — the app only ever hears
 * about codes that are worth trying.
 */
import { isRoomCode, normaliseRoomCode, roomLink } from '../net/index';
import type { MatchEnd } from '../match/index';
import { COPY, GAME_TITLE } from './copy';
import { el, setText, toggleAttr } from './dom';

export type LobbyState =
  | { kind: 'choose' }
  /** The code is out; waiting for the other device to turn up. */
  | { kind: 'hosting'; code: string }
  | { kind: 'joining'; code: string }
  | { kind: 'failed'; end: MatchEnd };

export interface LobbyHandlers {
  onCreate: () => void;
  /** Only ever called with a valid code. */
  onJoin: (code: string) => void;
  onBack: () => void;
}

export class LobbyScreen {
  readonly element: HTMLElement;

  private readonly choose: HTMLElement;
  private readonly room: HTMLElement;
  private readonly failed: HTMLElement;
  private readonly failedTitle: HTMLElement;
  private readonly failedDetail: HTMLElement;
  private readonly createButton: HTMLButtonElement;
  private readonly input: HTMLInputElement;
  private readonly error: HTMLElement;
  private readonly code: HTMLElement;
  private readonly link: HTMLInputElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly shareButton: HTMLButtonElement;
  private readonly copied: HTMLElement;
  private readonly status: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private kind: LobbyState['kind'] | null = null;

  constructor(handlers: LobbyHandlers) {
    this.element = el('div', 'screen screen--lobby');
    this.element.dataset['screen'] = 'lobby';

    const panel = el('div', 'lobby panel');
    panel.append(
      el('h2', 'heading', COPY.online.lobbyHeading),
      el('p', 'lobby__intro', COPY.online.lobbyIntro),
    );

    // --- create or join -------------------------------------------------

    this.createButton = el('button', 'btn btn--primary lobby__create');
    this.createButton.type = 'button';
    this.createButton.textContent = COPY.online.create;
    this.createButton.dataset['testid'] = 'btn-create-game';
    this.createButton.addEventListener('click', handlers.onCreate);

    const form = el('form', 'lobby__join');
    const label = el('label', 'eyebrow', COPY.online.codeLabel);
    label.htmlFor = 'room-code';

    this.input = el('input', 'lobby__input mono');
    this.input.id = 'room-code';
    this.input.type = 'text';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.maxLength = 12;
    this.input.placeholder = COPY.online.codeExample;
    this.input.dataset['testid'] = 'input-room-code';
    this.input.setAttribute('autocapitalize', 'characters');
    this.input.setAttribute('aria-describedby', 'room-code-error');
    // Codes are upper case and unspaced: show that as it is typed, rather than
    // rejecting what someone reasonably read off a screen.
    this.input.addEventListener('input', () => {
      const cleaned = normaliseRoomCode(this.input.value);
      if (this.input.value !== cleaned) this.input.value = cleaned;
      this.clearError();
    });

    const join = el('button', 'btn lobby__joinbtn');
    join.type = 'submit';
    join.textContent = COPY.online.join;
    join.dataset['testid'] = 'btn-join-game';

    this.error = el('p', 'lobby__error');
    this.error.id = 'room-code-error';
    this.error.dataset['testid'] = 'code-error';
    this.error.setAttribute('role', 'alert');
    this.error.hidden = true;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = normaliseRoomCode(this.input.value);
      this.input.value = code;
      if (!isRoomCode(code)) {
        setText(this.error, COPY.online.invalidCode);
        this.error.hidden = false;
        this.input.setAttribute('aria-invalid', 'true');
        this.input.focus();
        return;
      }
      this.clearError();
      handlers.onJoin(code);
    });

    const field = el('div', 'lobby__field');
    field.append(label, this.input, join);
    form.append(el('h3', 'lobby__subheading', COPY.online.joinHeading), field, this.error);

    this.choose = el('div', 'lobby__choose');
    this.choose.append(this.createButton, form);

    // --- the room, once it exists ---------------------------------------

    this.code = el('p', 'lobby__code mono');
    this.code.dataset['testid'] = 'room-code';

    this.link = el('input', 'lobby__link mono');
    this.link.type = 'text';
    this.link.readOnly = true;
    this.link.dataset['testid'] = 'room-link';
    this.link.setAttribute('aria-label', COPY.online.linkLabel);
    this.link.addEventListener('focus', () => this.link.select());

    this.copyButton = el('button', 'btn');
    this.copyButton.type = 'button';
    this.copyButton.textContent = COPY.online.copyLink;
    this.copyButton.dataset['testid'] = 'btn-copy-link';
    this.copyButton.addEventListener('click', () => {
      void this.copyLink();
    });

    this.shareButton = el('button', 'btn');
    this.shareButton.type = 'button';
    this.shareButton.textContent = COPY.online.share;
    this.shareButton.dataset['testid'] = 'btn-share';
    // Only where the device can actually share (iPadOS, Android, Safari).
    this.shareButton.hidden = typeof navigator.share !== 'function';
    this.shareButton.addEventListener('click', () => {
      void this.share();
    });

    this.copied = el('p', 'lobby__copied');
    this.copied.dataset['testid'] = 'copy-status';
    this.copied.setAttribute('role', 'status');
    this.copied.setAttribute('aria-live', 'polite');

    const actions = el('div', 'lobby__actions');
    actions.append(this.copyButton, this.shareButton);

    this.room = el('div', 'lobby__room');
    this.room.append(
      el('p', 'eyebrow', COPY.online.codeHeading),
      this.code,
      this.link,
      actions,
      this.copied,
      el('p', 'lobby__hint', COPY.online.codeHint),
    );

    // --- status and failure ---------------------------------------------

    this.status = el('p', 'lobby__status');
    this.status.dataset['testid'] = 'online-status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');

    this.failedTitle = el('h3', 'lobby__failed-title');
    this.failedDetail = el('p', 'lobby__hint');
    this.failed = el('div', 'lobby__failed');
    this.failed.setAttribute('role', 'alert');
    this.failed.append(this.failedTitle, this.failedDetail);

    this.backButton = el('button', 'btn btn--quiet lobby__back');
    this.backButton.type = 'button';
    this.backButton.textContent = COPY.online.back;
    this.backButton.dataset['testid'] = 'btn-back';
    this.backButton.addEventListener('click', handlers.onBack);

    panel.append(this.choose, this.room, this.status, this.failed, this.backButton);
    this.element.append(panel);
  }

  update(state: LobbyState): void {
    const changed = state.kind !== this.kind;
    this.kind = state.kind;
    this.element.dataset['state'] = state.kind;

    this.choose.hidden = state.kind !== 'choose';
    this.room.hidden = state.kind !== 'hosting';
    this.failed.hidden = state.kind !== 'failed';
    this.status.hidden = state.kind !== 'hosting' && state.kind !== 'joining';

    if (state.kind === 'hosting') {
      setText(this.code, state.code);
      const link = roomLink(state.code, window.location.href);
      if (this.link.value !== link) this.link.value = link;
      setText(this.status, COPY.online.waitingForFriend);
    }
    if (state.kind === 'joining') setText(this.status, COPY.online.joining(state.code));
    if (state.kind === 'failed') {
      const copy = COPY.online.ended[state.end];
      setText(this.failedTitle, copy.title);
      setText(this.failedDetail, copy.detail);
    }
    if (state.kind !== 'hosting') setText(this.copied, '');
    if (changed) this.focusState(state.kind);
  }

  /** Each state has one obvious next control: put the keyboard on it. */
  private focusState(kind: LobbyState['kind']): void {
    if (kind === 'choose') this.createButton.focus();
    else if (kind === 'hosting') this.copyButton.focus();
    else this.backButton.focus();
  }

  private clearError(): void {
    if (this.error.hidden) return;
    this.error.hidden = true;
    toggleAttr(this.input, 'aria-invalid', null);
  }

  private async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link.value);
      setText(this.copied, COPY.online.linkCopied);
    } catch {
      // No clipboard permission (or no clipboard at all): hand the player a
      // selected link instead of a dead button.
      this.link.focus();
      this.link.select();
      setText(this.copied, COPY.online.copyFallback);
    }
  }

  private async share(): Promise<void> {
    try {
      await navigator.share({
        title: GAME_TITLE,
        text: COPY.online.shareText,
        url: this.link.value,
      });
    } catch {
      // Cancelled, or the device changed its mind: nothing to say about it.
    }
  }
}
