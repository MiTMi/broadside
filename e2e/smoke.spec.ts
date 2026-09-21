/**
 * The end-to-end smoke test: one seeded game played to completion in the real
 * single-file build, plus the placement rules the player meets first.
 * `?seed=7&fast=1` makes the game deterministic and removes the CPU's thinking
 * delay (the CPU turn is still async, so we always wait for a fireable cell).
 */
import { expect, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * An automatic fixture: every test in this file fails if the page logged an
 * error or a warning, or threw. Asserted in teardown so it is checked even
 * when the test itself fails first.
 */
const test = base.extend<{ quietConsole: void }>({
  quietConsole: [
    async ({ page }: { page: Page }, use): Promise<void> => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          errors.push(`${message.type()}: ${message.text()}`);
        }
      });
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      await use();
      expect(errors, 'the page logged nothing and threw nothing').toEqual([]);
    },
    { auto: true },
  ],
});

const FIREABLE = '[data-testid^="enemy-cell-"][data-fireable="true"]';
/** Whichever comes first: the game is over, or a cell is ready to be fired at. */
const OVER_OR_FIREABLE = `[data-screen="over"], ${FIREABLE}`;
const MAX_SHOTS = 200;

/** The title screen is where every visit starts; "Play vs computer" opens placement. */
async function startFromTitle(page: Page): Promise<void> {
  await page.goto('/?seed=7&fast=1');
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  const play = page.getByTestId('btn-mode-solo');
  await expect(play).toBeFocused();
  await play.click();
  await expect(page.locator('[data-screen="placement"]')).toBeVisible();
}

test('plays a seeded game to the end and starts a new one', async ({ page }) => {
  await startFromTitle(page);

  await page.getByTestId('btn-random').click();
  await page.getByTestId('btn-start').click();
  await expect(page.locator('[data-screen="battle"]')).toBeVisible();

  let shots = 0;
  for (; shots < MAX_SHOTS; shots++) {
    // One wait for both outcomes: if the enemy wins, no cell ever becomes
    // fireable again, so waiting on a cell alone would hang here.
    const next = page.locator(OVER_OR_FIREABLE).first();
    await next.waitFor();
    if ((await next.getAttribute('data-screen')) === 'over') break;
    await next.click();
  }
  expect(shots, 'the game should end well inside the shot budget').toBeLessThan(MAX_SHOTS);

  await expect(page.getByTestId('result')).toHaveText(/^(Victory|Defeat)$/);
  await expect(page.getByTestId('btn-play-again')).toBeVisible();

  // Whichever result came up, its illustration is on the card and decoded —
  // an unresolvable src would still be "visible", so check the pixels exist.
  const art = page.getByTestId('result-art');
  await expect(art).toBeVisible();
  await expect
    .poll(async () => art.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBeGreaterThan(0);

  // "Play again" goes back to placement, never to the title screen (P11).
  await page.getByTestId('btn-play-again').click();
  await expect(page.locator('[data-screen="placement"]')).toBeVisible();
  await expect(page.locator('[data-screen="title"]')).toHaveCount(0);
  await expect(page.getByTestId('result')).toBeHidden();
});

test('places a ship by hand and refuses a touching one', async ({ page }) => {
  await startFromTitle(page);

  const carrier = page.getByTestId('btn-ship-carrier');
  const battleship = page.getByTestId('btn-ship-battleship');

  await carrier.click();
  await expect(carrier).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('own-cell-A1').click();
  await expect(carrier).toHaveAttribute('data-placed', 'true');
  await expect(page.locator('.hull--own')).toHaveCount(1);

  // Placing the carrier hands the selection to the next unplaced ship.
  await expect(battleship).toHaveAttribute('aria-pressed', 'true');

  // B3 touches the carrier (A1–A5) edge-on: the click must do nothing.
  await page.getByTestId('own-cell-B3').click();
  await expect(battleship).toHaveAttribute('data-placed', 'false');
  await expect(page.locator('.hull--own')).toHaveCount(1);

  // C1 leaves a clear row between the two hulls: allowed.
  await page.getByTestId('own-cell-C1').click();
  await expect(battleship).toHaveAttribute('data-placed', 'true');
  await expect(page.locator('.hull--own')).toHaveCount(2);
});
