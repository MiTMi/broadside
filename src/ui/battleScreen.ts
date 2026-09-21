/**
 * Battle: the interactive enemy tray dominates, the player's own tray is
 * secondary, fleet status silhouettes sit under each, and the log runs beneath.
 */
import { coordLabel, shipAt, toOpponentView } from '../engine/index';
import type { Coord, ShipId } from '../engine/index';
import type { MatchView } from '../match/index';
import { BoardView } from './boardView';
import type { HullView } from './boardView';
import { COPY, cellLabelFor } from './copy';
import { FleetStatus } from './fleetStatus';
import { BattleLog } from './log';
import { el } from './dom';

export interface BattleProps {
  /** Everything on screen comes from the match: solo and online look the same here. */
  match: MatchView;
}

export interface BattleHandlers {
  onFire: (coord: Coord) => void;
}

export class BattleScreen {
  readonly element: HTMLElement;

  private readonly enemyBoard: BoardView;
  private readonly ownBoard: BoardView;
  private readonly enemyFleet = new FleetStatus(COPY.battle.enemyFleet);
  private readonly ownFleet = new FleetStatus(COPY.battle.yourFleetStatus);
  private readonly logView = new BattleLog();

  constructor(handlers: BattleHandlers) {
    this.element = el('div', 'screen screen--battle');
    this.element.dataset['screen'] = 'battle';

    this.enemyBoard = new BoardView({
      ariaLabel: COPY.battle.enemyBoardLabel,
      testPrefix: 'enemy-cell',
      onActivate: handlers.onFire,
    });
    this.ownBoard = new BoardView({
      ariaLabel: COPY.battle.ownBoardLabel,
      testPrefix: 'own-cell',
      size: 'sm',
    });

    const enemy = el('section', 'screen__enemy');
    enemy.append(
      el('h2', 'heading', COPY.battle.enemyHeading),
      this.enemyBoard.element,
      this.enemyFleet.element,
    );

    const own = el('section', 'screen__own');
    own.append(
      el('h2', 'heading', COPY.battle.ownHeading),
      this.ownBoard.element,
      this.ownFleet.element,
    );

    this.element.append(enemy, own, this.logView.element);
  }

  /** Hands the keyboard straight to the enemy grid when the battle opens. */
  focusBoard(): void {
    this.enemyBoard.focusCell({ row: 0, col: 0 });
  }

  update(props: BattleProps): void {
    const { match } = props;
    const over = match.phase === 'over';
    this.element.dataset['screen'] = over ? 'over' : 'battle';
    const enemyView = match.enemyView;
    const ownBoard = match.ownBoard;
    const ownView = toOpponentView(ownBoard);

    const enemyHulls: HullView[] = enemyView.sunk.map(toHull('sunk'));
    // Only once the game is over — until then, the enemy fleet is not ours to know.
    const revealed = over ? match.enemyFleetRevealed : null;
    if (revealed) {
      const sunkIds = new Set(enemyView.sunk.map((ship) => ship.spec.id));
      for (const ship of revealed) {
        if (!sunkIds.has(ship.spec.id)) enemyHulls.push(toHull('ghost')(ship));
      }
    }

    this.enemyBoard.update({
      cells: enemyView.cells,
      hulls: enemyHulls,
      mode: over || match.locked || match.turn !== 'me' ? 'idle' : 'fire',
      cellLabel: (coord, state) => cellLabelFor(coordLabel(coord), state),
    });

    this.ownBoard.update({
      cells: ownView.cells,
      hulls: ownBoard.ships.map(toHull('own')),
      mode: 'idle',
      cellLabel: (coord, state) => {
        const ship = shipAt(ownBoard, coord);
        const label = coordLabel(coord);
        if (!ship) return cellLabelFor(label, state);
        const base = COPY.cell.ownShip(label, ship.spec.name);
        return state === 'unknown' ? base : `${base}, ${COPY.cell.state[state]}`;
      },
    });

    this.enemyFleet.update(sunkIds(enemyView.sunk.map((ship) => ship.spec.id)));
    this.ownFleet.update(sunkIds(ownView.sunk.map((ship) => ship.spec.id)));
    this.logView.update(match.log);
  }
}

function toHull(variant: HullView['variant']) {
  return (ship: {
    origin: Coord;
    orientation: HullView['orientation'];
    spec: { id: ShipId; length: number };
  }): HullView => ({
    id: ship.spec.id,
    row: ship.origin.row,
    col: ship.origin.col,
    length: ship.spec.length,
    orientation: ship.orientation,
    variant,
  });
}

function sunkIds(ids: readonly ShipId[]): ReadonlySet<ShipId> {
  return new Set(ids);
}
