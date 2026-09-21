import { describe, expect, it } from 'vitest';
import { mulberry32, randomFleet, type Difficulty } from '../../src/engine/index';
import { playSolo } from './helpers';

const GAMES = 300;

/** Mean shots the AI needs to sink a full fleet, over GAMES seeded boards. */
function meanShots(difficulty: Difficulty): number {
  let total = 0;
  for (let seed = 0; seed < GAMES; seed++) {
    total += playSolo(randomFleet(mulberry32(seed)), difficulty, mulberry32(seed + 500_000)).shots;
  }
  return total / GAMES;
}

describe(`AI strength over ${GAMES} seeded games per difficulty`, () => {
  it('gets meaningfully better with each difficulty', { timeout: 120_000 }, () => {
    const easy = meanShots('easy');
    const normal = meanShots('normal');
    const hard = meanShots('hard');

    console.log(
      `mean shots to sink the fleet over ${GAMES} games — easy ${easy.toFixed(1)}, normal ${normal.toFixed(1)}, hard ${hard.toFixed(1)}`,
    );

    expect(easy).toBeLessThanOrEqual(120);
    expect(normal).toBeLessThanOrEqual(100);
    expect(hard).toBeLessThanOrEqual(90);
    expect(normal).toBeLessThanOrEqual(easy - 3);
    expect(hard).toBeLessThanOrEqual(normal - 3);
  });
});
