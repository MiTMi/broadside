/**
 * The application shell: owns the single `GameState`, the seeded `Rng` and the
 * placement-in-progress board, and re-renders the mounted screen on change.
 * No other module holds mutable game state.
 */
import {
  FLEET,
  canPlace,
  coordLabel,
  emptyBoard,
  isFleetComplete,
  mulberry32,
  newGame,
  placeShip,
  randomFleet,
  removeShip,
  sameCoord,
  shipAt,
  startBattle,
  takeShot,
  toOpponentView,
} from '../engine/index';
import type { Board, Coord, GameState, Orientation, ShipId, Side } from '../engine/index';
import { BattleScreen } from './battleScreen';
import { COPY, GAME_TITLE, shotMessage, sunkMessage } from './copy';
import { GameOverDialog } from './gameOver';
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
}

export function createApp(root: HTMLElement, options: AppOptions): void {
  const rng = mulberry32(options.seed);
  const cpu = createCpuController({ fast: options.fast });
  const touch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const resultDelay = options.fast ? 0 : 900;

  let game: GameState = newGame('normal');
  let placementBoard: Board = emptyBoard();
  let selected: ShipId | null = null;
  let orientation: Orientation = 'h';
  let preview: Coord | null = null;
  let entries: string[] = [];
  let locked = false;
  let resultTimer = 0;

  /** A UI state, not an engine phase: the engine is in `placement` throughout. */
  let view: 'title' | 'game' = 'title';
  let placement: PlacementScreen | null = null;
  let battle: BattleScreen | null = null;

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
  const result = new GameOverDialog(() => resetGame());
  const confirmNew = createConfirmDialog(() => resetGame());

  shell.append(topbar, main, result.element, confirmNew.element);
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

    onDifficulty(difficulty) {
      // Nothing is in flight during placement, so a fresh game state is safe.
      game = newGame(difficulty);
      render();
    },

    onStart() {
      if (!isFleetComplete(placementBoard)) return;
      game = startBattle(game, placementBoard, rng);
      entries = [];
      locked = false;
      options.sfx.play('start');
      mountBattle();
      render();
      battle?.focusBoard();
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
    if (locked || game.phase !== 'battle' || game.turn !== 'player') return;
    if (applyShot('player', coord).phase === 'over') {
      finish();
      return;
    }
    locked = true;
    render();
    cpu.take({
      view: toOpponentView(game.boards.player),
      difficulty: game.difficulty,
      rng,
      fire: (target) => {
        if (applyShot('opponent', target).phase === 'over') {
          finish();
          return;
        }
        locked = false;
        render();
      },
    });
  }

  function applyShot(by: Side, coord: Coord): GameState {
    game = takeShot(game, by, coord);
    const shot = game.lastShot;
    if (shot) {
      const next = [...entries, shotMessage(by, coordLabel(shot.coord), shot.outcome)];
      if (shot.outcome === 'sunk' && shot.ship) next.push(sunkMessage(by, shot.ship.name));
      entries = next;
      options.sfx.play(shot.outcome === 'miss' ? 'miss' : shot.outcome === 'sunk' ? 'sunk' : 'hit');
    }
    return game;
  }

  function finish(): void {
    locked = true;
    render();
    const won = game.winner === 'player';
    // A win gets the "enemy ship destroyed" clip first; the fanfare waits for the card.
    const clip = won && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!clip) options.sfx.play(won ? 'win' : 'lose');
    window.clearTimeout(resultTimer);
    // A short beat so the last peg drop is seen before the card covers it.
    resultTimer = window.setTimeout(() => {
      const stats = game.stats.player;
      const accuracy = stats.shots === 0 ? 0 : Math.round((stats.hits / stats.shots) * 100);
      const shipsLeft = toOpponentView(game.boards.opponent).remaining.length;
      result.show({
        won,
        video: clip,
        muted: options.sfx.isMuted(),
        ...(clip ? { onReveal: () => options.sfx.play('win') } : {}),
        detail: won
          ? COPY.over.victoryDetail(stats.shots, accuracy)
          : COPY.over.defeatDetail(shipsLeft),
      });
    }, resultDelay);
  }

  function resetGame(): void {
    cpu.cancel();
    window.clearTimeout(resultTimer);
    result.close();
    confirmNew.close();
    game = newGame(game.difficulty);
    placementBoard = emptyBoard();
    selected = null;
    orientation = 'h';
    preview = null;
    entries = [];
    locked = false;
    mountPlacement();
    render();
    // The control that was focused (a dialog button) is gone: move on cleanly.
    placement?.focusFirstShip();
  }

  // --- rendering ---------------------------------------------------------

  function mountTitle(): TitleScreen {
    view = 'title';
    placement = null;
    battle = null;
    const screen = new TitleScreen(startFromTitle);
    main.replaceChildren(screen.element);
    return screen;
  }

  function startFromTitle(): void {
    options.sfx.play('select');
    mountPlacement();
    render();
    placement?.focusFirstShip();
  }

  function mountPlacement(): void {
    view = 'game';
    battle = null;
    placement = new PlacementScreen(placementHandlers);
    main.replaceChildren(placement.element);
  }

  function mountBattle(): void {
    view = 'game';
    placement = null;
    battle = new BattleScreen({ onFire: fireAtEnemy });
    main.replaceChildren(battle.element);
  }

  function render(): void {
    const phase = game.phase;
    // `data-screen` lives on the mounted screen root only — exactly one node.
    shell.dataset['view'] = view;
    // The title screen carries its own wordmark and has nothing to control.
    topbar.hidden = view === 'title';
    newGameButton.hidden = phase === 'placement';

    if (view === 'title') return;

    if (phase === 'placement') {
      toggleAttr(status, 'data-turn', 'none');
      setText(statusText, COPY.tagline);
      placement?.update({ board: placementBoard, selected, orientation, preview, difficulty: game.difficulty, touch });
      return;
    }

    if (phase === 'over') {
      toggleAttr(status, 'data-turn', game.winner === 'player' ? 'player' : 'opponent');
      setText(statusText, game.winner === 'player' ? COPY.over.victory : COPY.over.defeat);
    } else {
      const mine = game.turn === 'player' && !locked;
      toggleAttr(status, 'data-turn', mine ? 'player' : 'opponent');
      setText(statusText, mine ? COPY.battle.yourTurn : COPY.battle.enemyAiming);
    }
    battle?.update({ game, locked, log: entries });
  }

  // --- wiring ------------------------------------------------------------

  newGameButton.addEventListener('click', () => {
    if (game.phase === 'battle') confirmNew.open();
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
    if (view !== 'game' || game.phase !== 'placement') return;
    if (event.key !== 'r' && event.key !== 'R') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type !== 'radio') return;
    if (target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    placementHandlers.onRotate();
  });

  syncSound();
  const titleScreen = mountTitle();
  render();
  // Focus lands on "Play", so Enter starts the game straight away (P11).
  titleScreen.focusPlay();
}

/** The "New game" confirmation — an in-page modal, never `window.confirm`. */
function createConfirmDialog(onConfirm: () => void): {
  element: HTMLDialogElement;
  open: () => void;
  close: () => void;
} {
  const element = el('dialog', 'modal modal--confirm');
  const card = el('div', 'modal__card');
  card.append(
    el('h2', 'heading', COPY.confirm.title),
    el('p', 'modal__detail', COPY.confirm.body),
  );

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
    open: (): void => {
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
