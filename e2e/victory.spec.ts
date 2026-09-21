/**
 * The win path: a victory plays the "enemy ship destroyed" clip first, and only
 * then (or on Skip) reveals the Victory card. With reduced motion the clip is
 * skipped entirely. `?seed=1` on Easy is a game this hunt-and-target player wins.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function winSeededGame(page: Page): Promise<void> {
  await page.goto('/?seed=1&fast=1');
  await page.getByTestId('btn-play').click();
  await page.getByTestId('btn-difficulty-easy').click();
  await page.getByTestId('btn-random').click();
  await page.getByTestId('btn-start').click();

  await page.evaluate(async () => {
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    const position = (cell: HTMLElement): [number, number] => {
      const match = /enemy-cell-([A-L])(\d+)/.exec(cell.dataset['testid'] ?? '');
      return match ? [(match[1] ?? 'A').charCodeAt(0) - 65, Number(match[2]) - 1] : [0, 0];
    };
    const stateAt = (row: number, col: number): string | undefined =>
      document.querySelector<HTMLElement>(`[data-testid="enemy-cell-${String.fromCharCode(65 + row)}${col + 1}"]`)
        ?.dataset['state'];
    const pick = (): HTMLElement | undefined => {
      const cells = [...document.querySelectorAll<HTMLElement>('[data-testid^="enemy-cell-"][data-fireable="true"]')];
      const nearHit = cells.find((cell) => {
        const [row, col] = position(cell);
        return [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]].some(
          ([r, c]) => stateAt(r ?? -1, c ?? -1) === 'hit',
        );
      });
      if (nearHit) return nearHit;
      return cells.find((cell) => { const [row, col] = position(cell); return (row + col) % 2 === 0; }) ?? cells[0];
    };
    for (let shot = 0; shot < 600 && !document.querySelector('[data-screen="over"]'); shot++) {
      pick()?.click();
      await sleep(8);
    }
  });
  await expect(page.locator('[data-screen="over"]')).toBeVisible();
}

test('a win plays the victory clip, and Skip reveals the Victory card', async ({ page }) => {
  await winSeededGame(page);

  const video = page.getByTestId('victory-video');
  await expect(video).toBeVisible();
  await expect(page.getByTestId('btn-play-again')).toBeHidden();
  // The clip is really there and decodable: 10 seconds of 854×480 video.
  await expect.poll(async () => video.evaluate((el: HTMLVideoElement) => el.videoWidth)).toBe(854);
  await expect.poll(async () => video.evaluate((el: HTMLVideoElement) => Math.round(el.duration))).toBe(10);

  await page.getByTestId('btn-skip-video').click();
  await expect(video).toBeHidden();
  await expect(page.getByTestId('result')).toHaveText('Victory');
  await expect(page.getByTestId('btn-play-again')).toBeFocused();
  await expect.poll(async () => video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
});

test('with reduced motion a win goes straight to the Victory card', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await winSeededGame(page);
  await expect(page.getByTestId('result')).toHaveText('Victory');
  await expect(page.getByTestId('victory-video')).toBeHidden();
  await expect(page.getByTestId('btn-play-again')).toBeVisible();
});
