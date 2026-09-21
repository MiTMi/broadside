import type { ShipSpec } from './types';

/** USER-SPECIFIED fleet: 8 ships, 5/4/3/3/3/2/2/2 = 24 cells. */
export const FLEET: readonly ShipSpec[] = [
  { id: 'carrier', name: 'carrier', length: 5 },
  { id: 'battleship', name: 'battleship', length: 4 },
  { id: 'cruiser', name: 'cruiser', length: 3 },
  { id: 'submarine', name: 'submarine', length: 3 },
  { id: 'frigate', name: 'frigate', length: 3 },
  { id: 'destroyer', name: 'destroyer', length: 2 },
  { id: 'corvette', name: 'corvette', length: 2 },
  { id: 'patrol', name: 'patrol boat', length: 2 },
];

export const FLEET_CELLS = FLEET.reduce((sum, spec) => sum + spec.length, 0);
