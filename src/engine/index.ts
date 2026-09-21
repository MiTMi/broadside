// The UI imports the engine only through this barrel.
export * from './types';
export { mulberry32 } from './rng';
export { inBounds, coordLabel, parseLabel, sameCoord, cellKey, neighbours4, neighbours8 } from './coords';
export { FLEET, FLEET_CELLS } from './fleet';
export {
  emptyBoard,
  shipCells,
  canPlace,
  haloCells,
  placeShip,
  removeShip,
  shipAt,
  isFleetComplete,
  randomFleet,
  fire,
  isClearWater,
  isSunk,
  allSunk,
} from './board';
export { toOpponentView } from './view';
export { chooseShot } from './ai';
export { newGame, startBattle, takeShot, other } from './game';
