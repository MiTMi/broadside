/**
 * The application shell: owns the current `Match`, the seeded `Rng` and the
 * placement-in-progress board, and re-renders the mounted screen whenever the
 * match changes. No other module holds mutable game state, and nothing here
 * knows how the match is played — solo and online look the same from here
 * (Decision N6).
 *
 * Online adds one route (the lobby) and one fact the view-model does not
 * carry: whether the other device has turned up. That comes from the
 * transport's `onOpen`, which is why the shell — not the match — creates the
 * transport.
 */
import {
  FLEET,
  canPlace,
  emptyBoard,
  isFleetComplete,
  mulberry32,
  placeShip,
  randomFleet,
  removeShip,
  sameCoord,
  shipAt,
} from '../engine/index';
import type { Board, Coord, Difficulty, Orientation, ShipId } from '../engine/index';
import { createOnlineMatch, createSoloMatch } from '../match/index';
import type { Match, MatchEnd, MatchMessages, MatchPhase, MatchView } from '../match/index';
import { createTransport, generateRoomCode, roomCodeTaken } from '../net/index';
import type { Transport, TransportKind, TransportRole } from '../net/index';
import { BattleScreen } from './battleScreen';
import {
  COPY,
  GAME_TITLE,
  onlineShotMessage,
  onlineSunkMessage,
  shotMessage,
  sunkMessage,
} from './copy';
import { DisconnectDialog } from './disconnectDialog';
import { GameOverDialog } from './gameOver';
import { LobbyScreen } from './lobbyScreen';
import type { LobbyState } from './lobbyScreen';
import { PlacementScreen } from './placementScreen';
import type { PlacementHandlers } from './placementScreen';
import { TitleScreen } from './titleScreen';
import { createCpuController } from './cpuController';
import type { Sfx } from './sfx';
import { el, setText, toggleAttr } from './dom';

export interface AppOptions {
  sfx: Sfx;
  seed: number;
  /** `?fast=1`: no CPU thinking delay and no pause before the result card. */
  fast: boolean;
  /** Which transport online games run on: `?transport=local` picks the tab-to-tab one. */
  transport: TransportKind;
  /** A deep link's room code (`?room=ABC234`) — opens straight into joining (N8). */
  room: string | null;
}

/** The match logs in the game's own words; the copy never leaves `copy.ts`. */
const SOLO_MESSAGES: MatchMessages = {
  shot: (by, label, outcome) => shotMessage(by === 'me' ? 'player' : 'opponent', label, outcome),
  sunk: (by, name) => sunkMessage(by === 'me' ? 'player' : 'opponent', name),
};

const ONLINE_MESSAGES: MatchMessages = {
  shot: (by, label, outcome) => onlineShotMessage(by, label, outcome),
  sunk: (by, name) => onlineSunkMessage(by, name),
};

/**
 * A backstop, not the timeout: a real transport gives up on its own after 20 s
 * (N9). `LocalTransport` has nothing to give up on, so the shell keeps its own
 * watch — otherwise a code typed into an empty room waits for ever.
 */
const JOIN_TIMEOUT = 25_000;

/** How many room codes a host may burn on collisions before it is not luck (N9). */
const MAX_ROOM_CODES = 3;

export function createApp(root: HTMLElement, options: AppOptions): void {
  const rng = mulberry32(options.seed);
  const cpu = createCpuController({ fast: options.fast });
  const touch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const resultDelay = options.fast ? 0 : 900;

  let difficulty: Difficulty = 'normal';
  /** The transport behind the current online match, while there is one. */
  let session: { transport: Transport; role: TransportRole } | null = null;
  /** Room codes tried for the game being created right now (N9). */
  let hostAttempts = 0;
  let match: Match = createSolo();
  let placementBoard: Board = emptyBoard();
  let selected: ShipId | null = null;
  let orientation: Orientation = 'h';
  let preview: Coord | null = null;
  let resultTimer = 0;
  let joinTimer = 0;
  /** The result card is shown once per game, on the way into `over`. */
  let finished = false;
  /** Drives the one-off work of a phase change (mount, focus, sound). */
  let lastPhase: MatchPhase = match.view.phase;

  /** A UI state, not a match phase: the match is in `placement` throughout. */
  let route: 'title' | 'lobby' | 'game' = 'title';
  let lobbyState: LobbyState = { kind: 'choose' };
  let title: TitleScreen | null = null;
  let lobby: LobbyScreen | null = null;
  let placement: PlacementScreen | null = null;
  let battle: BattleScreen | null = null;

  function createSolo(): Match {
    // Playing the computer means there is no session left to ask about.
    session = null;
    const created = createSoloMatch({ rng, difficulty, cpu, messages: SOLO_MESSAGES });
    return listen(created);
  }

  function listen(created: Match): Match {
    created.onChange(onMatchChange);
    created.onSfx((event) => options.sfx.play(event));
    return created;
  }

  function onMatchChange(): void {
    // A room code that was already taken is not news for the player (N9).
    if (route === 'lobby' && match.view.ended !== null && retryTakenRoomCode()) return;

    const view = match.view;
    const previous = lastPhase;
    lastPhase = view.phase;

    let focusShips = false;
    if (view.phase !== previous && route === 'game') {
      if (view.phase === 'battle') {
        options.sfx.play('start');
        mountBattle();
      } else if (previous === 'over' && view.phase === 'placement') {
        // Both players pressed "Play again": a fresh game, same connection (N7).
        newRound();
        focusShips = true;
      }
    }

    render();
    if (view.phase === 'battle' && previous !== 'battle' && route === 'game') battle?.focusBoard();
    if (focusShips) placement?.focusFirstShip();
    if (view.phase === 'over' && !finished) {
      finished = true;
      finish();
    }
  }

  // --- shell -------------------------------------------------------------

  const shell = el('div', 'app');
  const status = el('p', 'status');
  const statusText = el('span', 'status__text');
  status.append(el('span', 'status__dot'), statusText);

  const soundIcon = createSoundIcon();
  const soundButton = el('button', 'btn btn--quiet btn--icon');
  soundButton.type = 'button';
  soundButton.dataset['testid'] = 'btn-sound';
  soundButton.append(soundIcon);

  const newGameButton = el('button', 'btn btn--quiet');
  newGameButton.type = 'button';
  newGameButton.textContent = COPY.battle.newGame;
  newGameButton.dataset['testid'] = 'btn-new';

  const actions = el('div', 'topbar__actions');
  // Reserved slot: T3 replaces the silent Sfx implementation, not this markup.
  const soundSlot = el('div', 'topbar__slot');
  soundSlot.dataset['slot'] = 'sound';
  soundSlot.append(soundButton);
  actions.append(soundSlot, newGameButton);

  const topbar = el('header', 'topbar');
  topbar.append(el('h1', 'display topbar__wordmark', GAME_TITLE), status, actions);

  const main = el('main', 'app__main');
  const result = new GameOverDialog(
    () => playAgain(),
    // The game is over and the opponent is owed nothing but the `bye` that
    // `leave()` sends: no confirmation to sit through.
    () => backToTitle(),
  );
  const confirmNew = createConfirmDialog(() => confirmed());
  const disconnect = new DisconnectDialog(() => backToTitle());

  shell.append(topbar, main, result.element, confirmNew.element, disconnect.element);
  root.replaceChildren(shell);

  // --- placement ---------------------------------------------------------

  const placementHandlers: PlacementHandlers = {
    onSelectShip(id) {
      const placed = placementBoard.ships.find((ship) => ship.spec.id === id);
      if (placed) {
        placementBoard = removeShip(placementBoard, id);
        orientation = placed.orientation;
        selected = id;
      } else {
        selected = selected === id ? null : id;
      }
      preview = null;
      options.sfx.play('select');
      render();
    },

    onCellActivate(coord) {
      const existing = shipAt(placementBoard, coord);
      if (existing && existing.spec.id !== selected) {
        // Clicking a placed ship picks it back up (Decision 9).
        placementBoard = removeShip(placementBoard, existing.spec.id);
        selected = existing.spec.id;
        orientation = existing.orientation;
        preview = coord;
        options.sfx.play('select');
        render();
        return;
      }
      if (selected === null) return;

      // Touch has no hover: the first tap aims, a second tap on the same cell places.
      if (touch && (preview === null || !sameCoord(preview, coord))) {
        preview = coord;
        render();
        return;
      }

      const spec = FLEET.find((candidate) => candidate.id === selected);
      if (!spec || !canPlace(placementBoard, spec, coord, orientation)) return;
      placementBoard = placeShip(placementBoard, spec, coord, orientation);
      selected = nextUnplaced();
      preview = touch ? null : coord;
      options.sfx.play('place');
      render();
    },

    onCellHover(coord) {
      if (touch) return;
      preview = coord;
      render();
    },

    onCellFocus(coord) {
      preview = coord;
      render();
    },

    onRotate() {
      orientation = orientation === 'h' ? 'v' : 'h';
      render();
    },

    onRandom() {
      placementBoard = randomFleet(rng);
      selected = null;
      preview = null;
      options.sfx.play('place');
      render();
    },

    onClear() {
      placementBoard = emptyBoard();
      selected = null;
      preview = null;
      render();
    },

    onDifficulty(next) {
      // Nothing is in flight during placement, so a fresh match is safe.
      difficulty = next;
      match.leave();
      match = createSolo();
      lastPhase = match.view.phase;
      render();
    },

    onStart() {
      if (!isFleetComplete(placementBoard)) return;
      // Solo starts the battle here; online this only says "my fleet is in",
      // and the battle begins when the opponent says the same (N7).
      match.start(placementBoard);
    },
  };

  function nextUnplaced(): ShipId | null {
    const spec = FLEET.find(
      (candidate) => !placementBoard.ships.some((ship) => ship.spec.id === candidate.id),
    );
    return spec ? spec.id : null;
  }

  // --- battle ------------------------------------------------------------

  function fireAtEnemy(coord: Coord): void {
    match.fire(coord);
  }

  function verificationNote(view: MatchView): string | null {
    if (view.verification === 'ok') return COPY.online.verified;
    if (view.verification === 'mismatch') return COPY.online.mismatch;
    return null;
  }

  function finish(): void {
    const won = match.view.winner === 'me';
    // A win gets the "enemy ship destroyed" clip first; the fanfare waits for the card.
    const clip = won && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!clip) options.sfx.play(won ? 'win' : 'lose');
    window.clearTimeout(resultTimer);
    // A short beat so the last peg drop is seen before the card covers it.
    resultTimer = window.setTimeout(() => {
      // Re-read: the opponent's fleet reveal can land inside this beat.
      const view = match.view;
      const online = view.mode === 'online';
      const stats = view.stats.me;
      const accuracy = stats.shots === 0 ? 0 : Math.round((stats.hits / stats.shots) * 100);
      const shipsLeft = view.enemyView.remaining.length;
      result.show({
        won,
        video: clip,
        muted: options.sfx.isMuted(),
        ...(clip ? { onReveal: () => options.sfx.play('win') } : {}),
        detail: won
          ? online
            ? COPY.over.victoryDetailOnline(stats.shots, accuracy)
            : COPY.over.victoryDetail(stats.shots, accuracy)
          : online
            ? COPY.over.defeatDetailOnline(shipsLeft)
            : COPY.over.defeatDetail(shipsLeft),
        online,
        note: verificationNote(view),
        rematch: view.rematch,
      });
    }, resultDelay);
  }

  /** "Play again": a new solo game, or an offer the opponent has to accept (N7). */
  function playAgain(): void {
    if (match.view.mode === 'online') {
      match.requestRematch();
      return;
    }
    resetGame();
  }

  /** The next round of an online match: same connection, empty boards. */
  function newRound(): void {
    window.clearTimeout(resultTimer);
    result.close();
    finished = false;
    resetPlacement();
    mountPlacement();
  }

  function resetPlacement(): void {
    placementBoard = emptyBoard();
    selected = null;
    orientation = 'h';
    preview = null;
  }

  function resetGame(): void {
    match.leave();
    window.clearTimeout(resultTimer);
    result.close();
    confirmNew.close();
    match = createSolo();
    lastPhase = match.view.phase;
    resetPlacement();
    finished = false;
    route = 'game';
    mountPlacement();
    render();
    // The control that was focused (a dialog button) is gone: move on cleanly.
    placement?.focusFirstShip();
  }

  /** Leaves whatever is going on and starts over at the title screen. */
  function backToTitle(): void {
    match.leave();
    window.clearTimeout(resultTimer);
    clearJoinTimer();
    result.close();
    confirmNew.close();
    disconnect.close();
    match = createSolo();
    lastPhase = match.view.phase;
    resetPlacement();
    finished = false;
    lobbyState = { kind: 'choose' };
    mountTitle();
    render();
    title?.focusPlay();
  }

  // --- online ------------------------------------------------------------

  function openLobby(): void {
    options.sfx.play('select');
    lobbyState = { kind: 'choose' };
    mountLobby();
    render();
  }

  function startOnline(role: TransportRole, code: string): void {
    let transport: Transport;
    try {
      transport = createTransport(options.transport, role, code);
    } catch {
      // Constructing a transport should not throw — but if it ever does, the
      // player gets the same plain answer as any other failure to connect.
      lobbyState = { kind: 'failed', end: 'unreachable' };
      render();
      return;
    }

    match.leave();
    finished = false;
    resetPlacement();
    match = listen(
      createOnlineMatch({
        transport,
        messages: ONLINE_MESSAGES,
        opponentLabel: COPY.online.opponentLabel,
      }),
    );
    lastPhase = match.view.phase;
    session = { transport, role };
    if (role === 'host') hostAttempts += 1;
    // The one thing `MatchView` cannot tell us: the other device is here.
    transport.onOpen(onPeerArrived);

    clearJoinTimer();
    if (role === 'guest') {
      joinTimer = window.setTimeout(() => {
        if (route !== 'lobby' || lobbyState.kind !== 'joining') return;
        match.leave();
        lobbyState = { kind: 'failed', end: 'timeout' };
        render();
      }, JOIN_TIMEOUT);
    }

    lobbyState = role === 'host' ? { kind: 'hosting', code } : { kind: 'joining', code };
    render();
  }

  function onPeerArrived(): void {
    if (route !== 'lobby') return;
    clearJoinTimer();
    route = 'game';
    mountPlacement();
    render();
    placement?.focusFirstShip();
  }

  function clearJoinTimer(): void {
    window.clearTimeout(joinTimer);
    joinTimer = 0;
  }

  /**
   * The broker already had this room id, which says nothing about the player
   * or their connection: take another code and try again, quietly (N9). Only
   * a host can collide, and only a few times before something else is wrong.
   */
  function retryTakenRoomCode(): boolean {
    if (session === null || session.role !== 'host') return false;
    if (match.view.ended !== 'unreachable' || hostAttempts >= MAX_ROOM_CODES) return false;
    if (!roomCodeTaken(session.transport)) return false;
    startOnline('host', generateRoomCode());
    return true;
  }

  const lobbyHandlers = {
    onCreate(): void {
      hostAttempts = 0;
      startOnline('host', generateRoomCode());
    },
    onJoin(code: string): void {
      startOnline('guest', code);
    },
    onBack(): void {
      if (lobbyState.kind === 'choose') {
        backToTitle();
        return;
      }
      // Out of this room, but still in the lobby: another code may work.
      match.leave();
      clearJoinTimer();
      match = createSolo();
      lastPhase = match.view.phase;
      lobbyState = { kind: 'choose' };
      render();
    },
  };

  /** New game / Leave game, confirmed. */
  function confirmed(): void {
    if (match.view.mode === 'online') {
      confirmNew.close();
      backToTitle();
      return;
    }
    resetGame();
  }

  // --- rendering ---------------------------------------------------------

  function mountTitle(): TitleScreen {
    route = 'title';
    lobby = null;
    placement = null;
    battle = null;
    title = new TitleScreen({ onSolo: startSolo, onOnline: openLobby });
    main.replaceChildren(title.element);
    return title;
  }

  function mountLobby(): void {
    route = 'lobby';
    title = null;
    placement = null;
    battle = null;
    lobby = new LobbyScreen(lobbyHandlers);
    main.replaceChildren(lobby.element);
  }

  function startSolo(): void {
    options.sfx.play('select');
    route = 'game';
    mountPlacement();
    render();
    placement?.focusFirstShip();
  }

  function mountPlacement(): void {
    route = 'game';
    title = null;
    lobby = null;
    battle = null;
    placement = new PlacementScreen(placementHandlers);
    main.replaceChildren(placement.element);
  }

  function mountBattle(): void {
    route = 'game';
    title = null;
    lobby = null;
    placement = null;
    battle = new BattleScreen({ onFire: fireAtEnemy });
    main.replaceChildren(battle.element);
  }

  function render(): void {
    const view = match.view;
    const online = view.mode === 'online';
    const phase = view.phase;
    // `data-screen` lives on the mounted screen root only — exactly one node.
    shell.dataset['view'] = route;
    // The title screen carries its own wordmark and has nothing to control.
    topbar.hidden = route === 'title';
    // Online there is no new game to start alone: the button leaves the match.
    newGameButton.hidden = route !== 'game' || (!online && phase === 'placement');
    setText(newGameButton, online ? COPY.online.leave : COPY.battle.newGame);

    if (route === 'title') return;

    if (route === 'lobby') {
      toggleAttr(status, 'data-turn', 'none');
      // The panel below already says "Play online": the bar keeps the tagline.
      setText(statusText, COPY.tagline);
      // A session that died before it started is the lobby's news to break.
      if (view.ended !== null && lobbyState.kind !== 'choose') {
        lobbyState = { kind: 'failed', end: view.ended };
      }
      lobby?.update(lobbyState);
      return;
    }

    if (phase === 'placement' || phase === 'waiting-opponent') {
      toggleAttr(status, 'data-turn', 'none');
      setText(statusText, COPY.tagline);
      placement?.update({
        board: placementBoard,
        selected,
        orientation,
        preview,
        difficulty,
        touch,
        showDifficulty: !online,
        waiting: phase === 'waiting-opponent',
      });
    } else {
      if (phase === 'over') {
        toggleAttr(status, 'data-turn', view.winner === 'me' ? 'player' : 'opponent');
        setText(statusText, view.winner === 'me' ? COPY.over.victory : COPY.over.defeat);
      } else {
        const mine = view.turn === 'me' && !view.locked;
        toggleAttr(status, 'data-turn', mine ? 'player' : 'opponent');
        setText(
          statusText,
          mine
            ? COPY.battle.yourTurn
            : online
              ? COPY.online.opponentTurn
              : COPY.battle.enemyAiming,
        );
      }
      battle?.update({ match: view });
    }

    // The card is up for the whole rematch handshake: keep its live bits fresh.
    result.setStatus({ online, note: verificationNote(view), rematch: view.rematch });

    if (view.ended !== null) showDisconnect(view.ended);
  }

  /**
   * The session stopped for a reason that is not a finished game. Whatever else
   * is on screen gives way: a result card with a dead "Play again" underneath a
   * lost connection is exactly the stuck spinner this replaces (N7).
   */
  function showDisconnect(end: MatchEnd): void {
    window.clearTimeout(resultTimer);
    result.close();
    confirmNew.close();
    disconnect.show(end);
  }

  // --- wiring ------------------------------------------------------------

  newGameButton.addEventListener('click', () => {
    const online = match.view.mode === 'online';
    // Online, leaving always costs the opponent their game: always confirm.
    if (online || match.view.phase === 'battle') confirmNew.open(online);
    else resetGame();
  });

  soundButton.addEventListener('click', () => {
    options.sfx.setMuted(!options.sfx.isMuted());
    syncSound();
  });

  function syncSound(): void {
    const muted = options.sfx.isMuted();
    soundIcon.classList.toggle('is-muted', muted);
    soundButton.setAttribute('aria-pressed', String(!muted));
    soundButton.setAttribute('aria-label', muted ? COPY.battle.soundOff : COPY.battle.soundOn);
  }

  document.addEventListener('keydown', (event) => {
    if (route !== 'game' || match.view.phase !== 'placement') return;
    if (event.key !== 'r' && event.key !== 'R') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type !== 'radio') return;
    if (target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    placementHandlers.onRotate();
  });

  // A closing tab is a player leaving: tell the opponent while we still can
  // (D10). Solo, this only cancels the computer's pending turn.
  window.addEventListener('pagehide', () => {
    match.leave();
  });

  syncSound();
  if (options.room !== null) {
    // A deep link is an invitation: go straight to joining that game (N8).
    mountLobby();
    startOnline('guest', options.room);
  } else {
    const titleScreen = mountTitle();
    render();
    // Focus lands on "Play vs computer", so Enter starts a game straight away.
    titleScreen.focusPlay();
  }
}

/** The "New game" / "Leave game" confirmation — an in-page modal, never `window.confirm`. */
function createConfirmDialog(onConfirm: () => void): {
  element: HTMLDialogElement;
  open: (online: boolean) => void;
  close: () => void;
} {
  const element = el('dialog', 'modal modal--confirm');
  const card = el('div', 'modal__card');
  const heading = el('h2', 'heading', COPY.confirm.title);
  const body = el('p', 'modal__detail', COPY.confirm.body);
  card.append(heading, body);

  const cancel = el('button', 'btn');
  cancel.type = 'button';
  cancel.textContent = COPY.confirm.cancel;
  cancel.dataset['testid'] = 'btn-keep-playing';
  cancel.addEventListener('click', () => element.close());

  const ok = el('button', 'btn btn--primary');
  ok.type = 'button';
  ok.textContent = COPY.confirm.ok;
  ok.dataset['testid'] = 'btn-confirm-new';
  ok.addEventListener('click', onConfirm);

  const row = el('div', 'modal__actions');
  row.append(cancel, ok);
  card.append(row);
  element.append(card);

  return {
    element,
    open: (online: boolean): void => {
      setText(heading, online ? COPY.confirm.leaveTitle : COPY.confirm.title);
      setText(body, online ? COPY.confirm.leaveBody : COPY.confirm.body);
      setText(ok, online ? COPY.confirm.leaveOk : COPY.confirm.ok);
      if (!element.open) element.showModal();
      cancel.focus();
    },
    close: (): void => {
      if (element.open) element.close();
    },
  };
}

function createSoundIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const cone = document.createElementNS(ns, 'path');
  cone.setAttribute('d', 'M4 8h3l4-3.5v11L7 12H4z');
  cone.setAttribute('class', 'icon__solid');

  const wave = document.createElementNS(ns, 'path');
  wave.setAttribute('d', 'M13.4 7.6a3.4 3.4 0 0 1 0 4.8');
  wave.setAttribute('class', 'icon__line icon__wave');

  const mute = document.createElementNS(ns, 'path');
  mute.setAttribute('d', 'M13.4 7.8l4.2 4.4m0-4.4l-4.2 4.4');
  mute.setAttribute('class', 'icon__line icon__mute');

  svg.append(cone, wave, mute);
  return svg;
}
