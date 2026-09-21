/**
 * One 12 x 12 tray. Renders peg wells, pegs, ship sprites and the placement
 * preview, and owns grid keyboard navigation (roving tabindex, arrows,
 * Enter/Space). Cells are updated in place so that only a new shot animates.
 */
import { BOARD_SIZE, cellKey, coordLabel } from '../engine/index';
import type { Coord, Orientation, ShipId, ViewCell } from '../engine/index';
import { shipSprite } from './assets';
import { COPY } from './copy';
import { el, toggleAttr } from './dom';

export type BoardMode = 'idle' | 'fire' | 'place';

export type HullVariant = 'own' | 'sunk' | 'ghost' | 'valid' | 'invalid';

export interface HullView {
  /** Which sprite to draw. */
  id: ShipId;
  row: number;
  col: number;
  length: number;
  orientation: Orientation;
  variant: HullVariant;
}

export interface BoardViewProps {
  /** What is known about each cell — drives the pegs. */
  cells: readonly (readonly ViewCell[])[];
  hulls: readonly HullView[];
  mode: BoardMode;
  /** Cell keys tinted as "no ship may go here" during placement. */
  forbidden?: ReadonlySet<number> | undefined;
  cellLabel: (coord: Coord, state: ViewCell) => string;
}

export interface BoardViewOptions {
  ariaLabel: string;
  /** `data-testid` prefix: "enemy-cell" → `enemy-cell-D4`. */
  testPrefix: string;
  size?: 'lg' | 'sm';
  onActivate?: ((coord: Coord) => void) | undefined;
  onHover?: ((coord: Coord | null) => void) | undefined;
  onFocusCell?: ((coord: Coord) => void) | undefined;
}

const COLUMN_LABELS = Array.from({ length: BOARD_SIZE }, (_, i) => String(i + 1));
const ROW_LABELS = Array.from({ length: BOARD_SIZE }, (_, i) => coordLabel({ row: i, col: 0 }).charAt(0));

export class BoardView {
  readonly element: HTMLDivElement;

  private readonly grid: HTMLDivElement;
  private readonly shipLayer: HTMLDivElement;
  private readonly cells: HTMLDivElement[] = [];
  private readonly states: ViewCell[] = [];
  private readonly hullNodes = new Map<string, HTMLElement>();
  private readonly options: BoardViewOptions;
  private mode: BoardMode = 'idle';
  private focus: Coord = { row: 0, col: 0 };
  private primed = false;

  constructor(options: BoardViewOptions) {
    this.options = options;
    this.element = el('div', `board${options.size === 'sm' ? ' board--sm' : ''}`);

    this.grid = el('div', 'board__grid');
    this.grid.setAttribute('role', 'grid');
    this.grid.setAttribute('aria-label', options.ariaLabel);
    this.element.append(this.grid);

    this.grid.append(this.buildHeaderRow());
    for (let row = 0; row < BOARD_SIZE; row++) this.grid.append(this.buildRow(row));

    this.shipLayer = el('div', 'board__ships');
    this.shipLayer.setAttribute('role', 'presentation');
    this.shipLayer.setAttribute('aria-hidden', 'true');
    this.grid.append(this.shipLayer);

    this.grid.addEventListener('click', this.handleClick);
    this.grid.addEventListener('keydown', this.handleKeydown);
    if (options.onHover) {
      this.grid.addEventListener('pointerover', this.handlePointerOver);
      this.grid.addEventListener('pointerleave', this.handlePointerLeave);
    }
  }

  update(props: BoardViewProps): void {
    this.mode = props.mode;

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const coord = { row, col };
        const key = cellKey(coord);
        const cell = this.cells[key];
        if (!cell) continue;
        const state = props.cells[row]?.[col] ?? 'unknown';
        const previous = this.states[key] ?? 'unknown';
        this.states[key] = state;

        if (cell.dataset['state'] !== state) cell.dataset['state'] = state;
        toggleAttr(cell, 'aria-label', props.cellLabel(coord, state));

        const enabled = this.isEnabled(state);
        toggleAttr(cell, 'data-fireable', this.mode === 'fire' && enabled ? 'true' : null);
        toggleAttr(cell, 'data-placeable', this.mode === 'place' ? 'true' : null);
        toggleAttr(cell, 'aria-disabled', this.mode === 'fire' && !enabled ? 'true' : null);
        toggleAttr(cell, 'data-forbidden', props.forbidden?.has(key) ? 'true' : null);
        cell.tabIndex = this.mode !== 'idle' && this.isFocusCell(coord) ? 0 : -1;

        if (this.primed && state !== previous) this.animate(cell, previous, state);
      }
    }

    this.syncHulls(props.hulls);
    this.primed = true;
  }

  /** Moves the grid's roving focus without stealing focus from the page. */
  setFocusCell(coord: Coord): void {
    this.focus = coord;
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = this.cells[cellKey({ row, col })];
        if (cell) cell.tabIndex = this.mode !== 'idle' && this.isFocusCell({ row, col }) ? 0 : -1;
      }
    }
  }

  focusCell(coord: Coord): void {
    this.setFocusCell(coord);
    this.cells[cellKey(coord)]?.focus();
  }

  private isFocusCell(coord: Coord): boolean {
    return coord.row === this.focus.row && coord.col === this.focus.col;
  }

  private isEnabled(state: ViewCell): boolean {
    if (this.mode === 'place') return true;
    if (this.mode === 'fire') return state === 'unknown';
    return false;
  }

  private animate(cell: HTMLDivElement, previous: ViewCell, next: ViewCell): void {
    cell.classList.remove('cell--drop', 'cell--pulse');
    const dropped = (next === 'miss' || next === 'hit' || next === 'sunk') && (previous === 'unknown' || previous === 'clear');
    const pulsed = next === 'sunk';
    if (!dropped && !pulsed) return;
    void cell.offsetWidth; // restart the animation
    if (dropped) cell.classList.add('cell--drop');
    if (pulsed) cell.classList.add('cell--pulse');
  }

  private syncHulls(hulls: readonly HullView[]): void {
    const wanted = new Map<string, HullView>();
    for (const hull of hulls) {
      const key = `${hull.variant}:${hull.id}:${hull.row}:${hull.col}:${hull.length}:${hull.orientation}`;
      wanted.set(key, hull);
    }
    for (const [key, node] of this.hullNodes) {
      if (!wanted.has(key)) {
        node.remove();
        this.hullNodes.delete(key);
      }
    }
    for (const [key, hull] of wanted) {
      if (this.hullNodes.has(key)) continue;
      const node = el('span', `hull hull--${hull.variant} hull--${hull.orientation}`);
      const rows = hull.orientation === 'v' ? hull.length : 1;
      const cols = hull.orientation === 'h' ? hull.length : 1;
      node.style.gridArea = `${hull.row + 1} / ${hull.col + 1} / span ${rows} / span ${cols}`;
      // `--len` is what lets a vertical sprite be sized to its horizontal span
      // before being rotated (board.css), so it is set for both orientations.
      node.style.setProperty('--len', String(hull.length));
      node.append(shipSprite(hull.id, 'hull__img'));
      this.shipLayer.append(node);
      this.hullNodes.set(key, node);
    }
  }

  private buildHeaderRow(): HTMLDivElement {
    const row = el('div', 'board__row board__row--head');
    row.setAttribute('role', 'row');
    const corner = el('span', 'board__label');
    corner.setAttribute('role', 'columnheader');
    corner.setAttribute('aria-label', COPY.board.rowHeader);
    row.append(corner);
    for (const label of COLUMN_LABELS) {
      const head = el('span', 'board__label', label);
      head.setAttribute('role', 'columnheader');
      row.append(head);
    }
    return row;
  }

  private buildRow(row: number): HTMLDivElement {
    const node = el('div', 'board__row');
    node.setAttribute('role', 'row');
    const head = el('span', 'board__label', ROW_LABELS[row] ?? '');
    head.setAttribute('role', 'rowheader');
    node.append(head);

    for (let col = 0; col < BOARD_SIZE; col++) {
      const coord = { row, col };
      const label = coordLabel(coord);
      const cell = el('div', 'cell');
      cell.setAttribute('role', 'gridcell');
      cell.tabIndex = -1;
      cell.dataset['state'] = 'unknown';
      cell.dataset['coord'] = label;
      cell.dataset['index'] = String(cellKey(coord));
      cell.dataset['testid'] = `${this.options.testPrefix}-${label}`;
      cell.append(el('span', 'cell__well'), el('span', 'cell__ripple'), el('span', 'cell__peg'));
      node.append(cell);
      this.cells[cellKey(coord)] = cell;
      this.states[cellKey(coord)] = 'unknown';
    }
    return node;
  }

  private coordOf(target: EventTarget | null): Coord | null {
    if (!(target instanceof Element)) return null;
    const cell = target.closest('.cell');
    if (!(cell instanceof HTMLElement)) return null;
    const index = Number(cell.dataset['index']);
    if (!Number.isInteger(index)) return null;
    return { row: Math.floor(index / BOARD_SIZE), col: index % BOARD_SIZE };
  }

  private activate(coord: Coord): void {
    const state = this.states[cellKey(coord)] ?? 'unknown';
    if (!this.isEnabled(state)) return;
    this.options.onActivate?.(coord);
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const coord = this.coordOf(event.target);
    if (!coord) return;
    // The roving focus follows the pointer, so Tab returns to the last cell used.
    if (this.mode !== 'idle') this.setFocusCell(coord);
    this.activate(coord);
  };

  private readonly handlePointerOver = (event: PointerEvent): void => {
    const coord = this.coordOf(event.target);
    this.options.onHover?.(coord);
  };

  private readonly handlePointerLeave = (): void => {
    this.options.onHover?.(null);
  };

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    const coord = this.coordOf(event.target);
    if (!coord || this.mode === 'idle') return;

    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      this.activate(coord);
      return;
    }

    const next = { ...coord };
    switch (event.key) {
      case 'ArrowUp':
        next.row -= 1;
        break;
      case 'ArrowDown':
        next.row += 1;
        break;
      case 'ArrowLeft':
        next.col -= 1;
        break;
      case 'ArrowRight':
        next.col += 1;
        break;
      case 'Home':
        next.col = 0;
        break;
      case 'End':
        next.col = BOARD_SIZE - 1;
        break;
      case 'PageUp':
        next.row = 0;
        break;
      case 'PageDown':
        next.row = BOARD_SIZE - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    next.row = clamp(next.row);
    next.col = clamp(next.col);
    this.focusCell(next);
    this.options.onFocusCell?.(next);
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(BOARD_SIZE - 1, value));
}
