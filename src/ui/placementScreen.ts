/**
 * Placement: a large own tray on the left, the ship dock and the battle
 * controls on the right (stacked underneath on narrow screens).
 * Click to place, R to rotate, click a placed ship to pick it up again
 * (Decision 9); the forbidden halo is tinted while a ship is selected (8b).
 */
import {
  BOARD_SIZE,
  FLEET,
  canPlace,
  cellKey,
  coordLabel,
  haloCells,
  isFleetComplete,
  shipAt,
  shipCells,
} from '../engine/index';
import type { Board, Coord, Difficulty, Orientation, ShipId } from '../engine/index';
import { shipSprite } from './assets';
import { BoardView } from './boardView';
import type { HullView } from './boardView';
import { COPY, titleCase } from './copy';
import { el, must, setText, toggleAttr } from './dom';

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export interface PlacementProps {
  board: Board;
  selected: ShipId | null;
  orientation: Orientation;
  preview: Coord | null;
  difficulty: Difficulty;
  touch: boolean;
  /** Solo only: online there is no computer to set a level for (N7). */
  showDifficulty: boolean;
  /** Online: my fleet is in, the opponent is still placing theirs. */
  waiting: boolean;
}

export interface PlacementHandlers {
  onSelectShip: (id: ShipId) => void;
  onCellActivate: (coord: Coord) => void;
  /** Pointer hover — ignored on touch, where placement is two-tap. */
  onCellHover: (coord: Coord | null) => void;
  /** Keyboard focus moved: the preview always follows it. */
  onCellFocus: (coord: Coord) => void;
  onRotate: () => void;
  onRandom: () => void;
  onClear: () => void;
  onStart: () => void;
  onDifficulty: (difficulty: Difficulty) => void;
}

export class PlacementScreen {
  readonly element: HTMLElement;

  private readonly board: BoardView;
  private readonly shipButtons = new Map<ShipId, HTMLButtonElement>();
  private readonly difficultyInputs = new Map<Difficulty, HTMLInputElement>();
  private readonly actionButtons: HTMLButtonElement[] = [];
  private readonly hint: HTMLElement;
  private readonly remaining: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly difficulty: HTMLFieldSetElement;
  private readonly waiting: HTMLElement;

  constructor(handlers: PlacementHandlers) {
    this.element = el('div', 'screen screen--placement');
    this.element.dataset['screen'] = 'placement';

    this.board = new BoardView({
      ariaLabel: COPY.placement.boardLabel,
      testPrefix: 'own-cell',
      onActivate: handlers.onCellActivate,
      onHover: handlers.onCellHover,
      onFocusCell: handlers.onCellFocus,
    });
    const boardSlot = el('section', 'screen__board');
    boardSlot.append(this.board.element);

    const dock = el('aside', 'dock panel');
    const heading = el('h2', 'heading', COPY.placement.heading);
    this.hint = el('p', 'dock__hint', COPY.placement.hint);
    dock.append(heading, this.hint);

    const list = el('ul', 'dock__list');
    for (const spec of FLEET) {
      const button = el('button', 'ship');
      button.type = 'button';
      button.dataset['testid'] = `btn-ship-${spec.id}`;
      button.setAttribute('aria-pressed', 'false');

      const silhouette = el('span', 'ship__silhouette');
      silhouette.style.setProperty('--len', String(spec.length));
      silhouette.append(shipSprite(spec.id, 'chip-sprite'));
      const name = el('span', 'ship__name', titleCase(spec.name));
      const length = el('span', 'ship__length mono', `${spec.length}`);
      button.append(silhouette, name, length);
      button.addEventListener('click', () => handlers.onSelectShip(spec.id));

      const item = el('li', 'dock__item');
      item.append(button);
      list.append(item);
      this.shipButtons.set(spec.id, button);
    }
    dock.append(list);

    this.remaining = el('p', 'dock__remaining mono');

    const actions = el('div', 'dock__actions');
    actions.append(
      this.actionButton(COPY.placement.rotate, 'btn-rotate', handlers.onRotate),
      this.actionButton(COPY.placement.random, 'btn-random', handlers.onRandom),
      this.actionButton(COPY.placement.clear, 'btn-clear', handlers.onClear),
    );

    const fieldset = el('fieldset', 'dock__difficulty');
    fieldset.append(el('legend', 'eyebrow', COPY.placement.difficulty));
    const segmented = el('div', 'segmented');
    for (const difficulty of DIFFICULTIES) {
      const option = el('div', 'segmented__option');
      const input = el('input', 'segmented__input');
      input.type = 'radio';
      input.name = 'difficulty';
      input.value = difficulty;
      input.id = `difficulty-${difficulty}`;
      input.dataset['testid'] = `btn-difficulty-${difficulty}`;
      input.addEventListener('change', () => handlers.onDifficulty(difficulty));
      const label = el('label', 'segmented__label', COPY.difficulties[difficulty]);
      label.htmlFor = input.id;
      option.append(input, label);
      segmented.append(option);
      this.difficultyInputs.set(difficulty, input);
    }
    fieldset.append(segmented);

    this.difficulty = fieldset;

    this.startButton = el('button', 'btn btn--primary dock__start');
    this.startButton.type = 'button';
    this.startButton.textContent = COPY.placement.start;
    this.startButton.dataset['testid'] = 'btn-start';
    this.startButton.addEventListener('click', handlers.onStart);

    // Online, "Start battle" is only half of starting: it is replaced by the
    // wait for the other fleet (N7).
    this.waiting = el('p', 'dock__waiting');
    this.waiting.dataset['testid'] = 'online-status';
    this.waiting.setAttribute('role', 'status');
    this.waiting.setAttribute('aria-live', 'polite');
    this.waiting.hidden = true;

    dock.append(this.remaining, actions, fieldset, this.startButton, this.waiting);
    this.element.append(boardSlot, dock);
  }

  update(props: PlacementProps): void {
    const { board, selected, waiting } = props;
    this.element.dataset['waiting'] = waiting ? 'true' : 'false';

    this.board.update({
      cells: EMPTY_CELLS,
      hulls: this.hulls(props),
      // Waiting means the fleet is handed over: nothing about it may move now.
      mode: waiting ? 'idle' : 'place',
      forbidden: selected === null || waiting ? undefined : forbiddenCells(board),
      cellLabel: (coord) => {
        const ship = shipAt(board, coord);
        const label = coordLabel(coord);
        return ship ? COPY.cell.ownShip(label, ship.spec.name) : COPY.cell.empty(label);
      },
    });

    for (const [id, button] of this.shipButtons) {
      const placed = board.ships.some((ship) => ship.spec.id === id);
      toggleAttr(button, 'aria-pressed', selected === id ? 'true' : 'false');
      toggleAttr(button, 'data-placed', placed ? 'true' : 'false');
      button.disabled = waiting;
    }

    for (const [difficulty, input] of this.difficultyInputs) {
      input.checked = difficulty === props.difficulty;
    }
    this.difficulty.hidden = !props.showDifficulty;

    for (const button of this.actionButtons) button.disabled = waiting;

    setText(this.hint, props.touch ? COPY.placement.hintTouch : COPY.placement.hint);
    this.hint.hidden = waiting;
    const left = FLEET.length - board.ships.length;
    setText(this.remaining, left === 0 ? COPY.placement.ready : COPY.placement.remaining(left));
    this.startButton.disabled = waiting || !isFleetComplete(board);
    this.startButton.hidden = waiting;
    setText(this.waiting, COPY.online.waitingPlacement);
    this.waiting.hidden = !waiting;
  }

  focusFirstShip(): void {
    const first = FLEET[0];
    if (first) must(this.shipButtons.get(first.id), 'first ship button').focus();
  }

  private hulls(props: PlacementProps): HullView[] {
    const hulls: HullView[] = props.board.ships.map((ship) => ({
      id: ship.spec.id,
      row: ship.origin.row,
      col: ship.origin.col,
      length: ship.spec.length,
      orientation: ship.orientation,
      variant: 'own',
    }));

    const spec = FLEET.find((candidate) => candidate.id === props.selected);
    const preview = props.preview;
    if (spec && preview) {
      const room =
        props.orientation === 'h' ? BOARD_SIZE - preview.col : BOARD_SIZE - preview.row;
      hulls.push({
        id: spec.id,
        row: preview.row,
        col: preview.col,
        length: Math.max(1, Math.min(spec.length, room)),
        orientation: props.orientation,
        variant: canPlace(props.board, spec, preview, props.orientation) ? 'valid' : 'invalid',
      });
    }
    return hulls;
  }

  private actionButton(label: string, testid: string, onClick: () => void): HTMLButtonElement {
    const button = el('button', 'btn');
    button.type = 'button';
    button.textContent = label;
    button.dataset['testid'] = testid;
    button.addEventListener('click', onClick);
    this.actionButtons.push(button);
    return button;
  }
}

/** The placement board shows hulls, never pegs. */
const EMPTY_CELLS = Array.from({ length: BOARD_SIZE }, () =>
  Array.from({ length: BOARD_SIZE }, () => 'unknown' as const),
);

/** Cells no ship may occupy because they touch a placed ship. */
function forbiddenCells(board: Board): ReadonlySet<number> {
  const occupied = new Set<number>();
  for (const ship of board.ships) {
    for (const cell of shipCells(ship)) occupied.add(cellKey(cell));
  }
  const halo = new Set<number>();
  for (const ship of board.ships) {
    for (const cell of haloCells(ship)) {
      const key = cellKey(cell);
      if (!occupied.has(key)) halo.add(key);
    }
  }
  return halo;
}
