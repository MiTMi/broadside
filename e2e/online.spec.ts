/**
 * Two devices, one browser: every online test opens two pages in ONE context
 * and connects them with `?transport=local`, the BroadcastChannel transport
 * (Decision N2). No broker, no network, nothing flaky — and it is the same
 * `OnlineMatch` the real peer-to-peer transport drives.
 *
 * `fast=1` removes the pause before the result card; `seed=` fixes each side's
 * "Place randomly" fleet. Neither page is ever clicked out of turn: the loop
 * only ever fires a cell the page itself marks `data-fireable`.
 */
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

const FIREABLE = '[data-testid^="enemy-cell-"][data-fireable="true"]';
const OVER = '[data-screen="over"]';
const MAX_ROUNDS = 400;

/** Everything a page logged. Asserted empty at the end of every test. */
function trackConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      errors.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

interface Table {
  context: BrowserContext;
  host: Page;
  guest: Page;
  hostErrors: string[];
  guestErrors: string[];
}

async function openTable(browser: Browser): Promise<Table> {
  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const host = await context.newPage();
  const guest = await context.newPage();
  const table = {
    context,
    host,
    guest,
    hostErrors: trackConsole(host),
    guestErrors: trackConsole(guest),
  };
  // Different seeds so the two fleets are laid out differently.
  await host.goto('/?transport=local&fast=1&seed=11');
  await guest.goto('/?transport=local&fast=1&seed=22');
  return table;
}

/** Creates the game and returns the room code the other device needs. */
async function createGame(host: Page): Promise<string> {
  await host.getByTestId('btn-mode-online').click();
  await expect(host.locator('[data-screen="lobby"]')).toBeVisible();
  await host.getByTestId('btn-create-game').click();
  const code = (await host.getByTestId('room-code').textContent()) ?? '';
  expect(code, 'a room code is six characters of the no-lookalike alphabet').toMatch(
    /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/,
  );
  await expect(host.getByTestId('online-status')).toHaveText('Waiting for your friend to join…');
  return code;
}

/** Both fleets placed at random, then both "Start battle" (N7). */
async function bothPlace(host: Page, guest: Page): Promise<void> {
  for (const page of [host, guest]) {
    await expect(page.locator('[data-screen="placement"]')).toBeVisible();
    await page.getByTestId('btn-random').click();
    await page.getByTestId('btn-start').click();
  }
  await expect(host.locator('[data-screen="battle"]')).toBeVisible();
  await expect(guest.locator('[data-screen="battle"]')).toBeVisible();
}

/**
 * Fires one shot if this page has a shot to fire — hunting around its own hits
 * first, then on a parity, exactly as a player would. Returns false when the
 * page has nothing fireable, which is how it says "not my turn".
 */
async function fireOne(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const cells = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid^="enemy-cell-"][data-fireable="true"]',
      ),
    ];
    if (cells.length === 0) return false;
    const position = (cell: HTMLElement): [number, number] => {
      const match = /enemy-cell-([A-L])(\d+)/.exec(cell.dataset['testid'] ?? '');
      return match ? [(match[1] ?? 'A').charCodeAt(0) - 65, Number(match[2]) - 1] : [0, 0];
    };
    const stateAt = (row: number, col: number): string | undefined =>
      document.querySelector<HTMLElement>(
        `[data-testid="enemy-cell-${String.fromCharCode(65 + row)}${col + 1}"]`,
      )?.dataset['state'];
    const nearHit = cells.find((cell) => {
      const [row, col] = position(cell);
      return [
        [row - 1, col],
        [row + 1, col],
        [row, col - 1],
        [row, col + 1],
      ].some(([r, c]) => stateAt(r ?? -1, c ?? -1) === 'hit');
    });
    const parity = cells.find((cell) => {
      const [row, col] = position(cell);
      return (row + col) % 2 === 0;
    });
    (nearHit ?? parity ?? cells[0])?.click();
    return true;
  });
}

async function isOver(page: Page): Promise<boolean> {
  return (await page.locator(OVER).count()) > 0;
}

/** Plays both sides to the end. Never waits on one page alone — that deadlocks. */
async function playToTheEnd(a: Page, b: Page): Promise<void> {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if ((await isOver(a)) || (await isOver(b))) return;
    const firedA = await fireOne(a);
    const firedB = await fireOne(b);
    // Both idle: a shot is in flight between the tabs. Let it land.
    if (!firedA && !firedB) await a.waitForTimeout(20);
  }
  throw new Error('the game did not finish inside the shot budget');
}

/**
 * The privacy invariant (Decision N3): the only enemy hulls this device may
 * have are the ones it has sunk. Nothing else on the enemy tray may name,
 * draw or mark a ship that is still afloat.
 */
async function expectNoFleetLeak(page: Page): Promise<void> {
  const hulls = await page.locator('.screen__enemy .hull').count();
  const sunk = await page.locator('.screen__enemy .fleet__item[data-sunk="true"]').count();
  expect(hulls, 'the enemy tray shows sunk ships and nothing else').toBe(sunk);
}

test('two devices play a whole game, and then a rematch', async ({ browser }) => {
  const { context, host, guest, hostErrors, guestErrors } = await openTable(browser);
  const code = await createGame(host);

  // The guest types the code the way it would be read out: any case, spaced.
  await guest.getByTestId('btn-mode-online').click();
  const input = guest.getByTestId('input-room-code');
  await input.pressSequentially(`${code.slice(0, 3)} ${code.slice(3)}`.toLowerCase());
  await expect(input).toHaveValue(code);
  await guest.getByTestId('btn-join-game').click();

  // Both devices land in placement, and neither is offered a CPU difficulty.
  await expect(host.locator('[data-screen="placement"]')).toBeVisible();
  await expect(guest.locator('[data-screen="placement"]')).toBeVisible();
  await expect(host.getByTestId('btn-difficulty-normal')).toBeHidden();

  // Placement is simultaneous: whoever is ready first waits, board locked.
  await host.getByTestId('btn-random').click();
  await host.getByTestId('btn-start').click();
  await expect(host.getByTestId('online-status')).toHaveText(
    'Waiting for your opponent to finish placing…',
  );
  await expect(host.locator('[data-placeable="true"]')).toHaveCount(0);
  await expect(host.getByTestId('btn-random')).toBeDisabled();

  await guest.getByTestId('btn-random').click();
  await guest.getByTestId('btn-start').click();
  await expect(host.locator('[data-screen="battle"]')).toBeVisible();
  await expect(guest.locator('[data-screen="battle"]')).toBeVisible();

  // The host fires first (N7), and says so; the guest is told to wait.
  await expect(host.locator('.status__text')).toHaveText(
    'Your turn — pick a square in enemy waters',
  );
  await expect(guest.locator('.status__text')).toHaveText("Opponent's turn…");
  await expect(host.locator(FIREABLE).first()).toBeVisible();
  await expect(guest.locator(FIREABLE)).toHaveCount(0);

  await playToTheEnd(host, guest);
  await expect(host.locator(OVER)).toBeVisible();
  await expect(guest.locator(OVER)).toBeVisible();

  // Each side logs the other in the game's own words.
  await expect(host.locator('.log__list')).toContainText('Your opponent fires at');

  await expect(host.getByTestId('result')).toHaveText(/^(Victory|Defeat)$/);
  const hostWon = (await host.getByTestId('result').textContent()) === 'Victory';
  const winner = hostWon ? host : guest;
  const loser = hostWon ? guest : host;

  // The winner gets the clip first, then the card; the loser gets the card.
  await expect(winner.getByTestId('victory-video')).toBeVisible();
  await winner.getByTestId('btn-skip-video').click();
  await expect(winner.getByTestId('result')).toHaveText('Victory');
  await expect(loser.getByTestId('result')).toHaveText('Defeat');

  // Both fleets are revealed at the end and both check out (N4).
  await expect(winner.getByTestId('verify-note')).toHaveText('Fleet verified');
  await expect(loser.getByTestId('verify-note')).toHaveText('Fleet verified');

  // A rematch takes two: one asks, the other accepts.
  await winner.getByTestId('btn-play-again').click();
  await expect(winner.getByTestId('rematch-status')).toHaveText('Waiting for your opponent…');
  await expect(winner.getByTestId('btn-play-again')).toBeDisabled();
  // …and whoever is waiting can always walk away instead: the card is modal,
  // so the way out has to be on it.
  await expect(winner.getByTestId('btn-leave')).toBeVisible();
  await expect(loser.getByTestId('rematch-status')).toHaveText('Your opponent wants a rematch.');
  await loser.getByTestId('btn-play-again').click();

  await bothPlace(winner, loser);
  // Roles keep, but the loser of the first game opens the second one (N7).
  await expect(loser.locator(FIREABLE).first()).toBeVisible();
  await expect(winner.locator(FIREABLE)).toHaveCount(0);

  expect(hostErrors, 'the host page logged nothing').toEqual([]);
  expect(guestErrors, 'the guest page logged nothing').toEqual([]);
  await context.close();
});

test('the shared link joins the game straight away', async ({ browser }) => {
  const { context, host, guest, hostErrors, guestErrors } = await openTable(browser);
  const code = await createGame(host);

  const link = await host.getByTestId('room-link').inputValue();
  expect(link).toContain(`room=${code}`);

  // "Copy link" really copies it.
  await host.getByTestId('btn-copy-link').click();
  await expect(host.getByTestId('copy-status')).toHaveText('Link copied');
  expect(await host.evaluate(() => navigator.clipboard.readText())).toBe(link);

  // Opening the link is all the second player has to do.
  await guest.goto(link);
  await expect(guest.locator('[data-screen="placement"]')).toBeVisible();
  await expect(host.locator('[data-screen="placement"]')).toBeVisible();

  expect(hostErrors).toEqual([]);
  expect(guestErrors).toEqual([]);
  await context.close();
});

test('a device that goes away leaves the other one a way out', async ({ browser }) => {
  const { context, host, guest, hostErrors } = await openTable(browser);
  const code = await createGame(host);

  await guest.getByTestId('btn-mode-online').click();
  await guest.getByTestId('input-room-code').fill(code);
  await guest.getByTestId('btn-join-game').click();
  await bothPlace(host, guest);

  // One shot in, so the disconnect lands in the middle of a real battle.
  expect(await fireOne(host)).toBe(true);
  await expect(guest.locator(FIREABLE).first()).toBeVisible();

  await guest.close();
  const dialog = host.getByTestId('disconnect');
  await expect(dialog).toBeVisible();
  await expect(host.getByTestId('disconnect-title')).toHaveText('Your opponent left the game');

  await host.getByTestId('btn-back-title').click();
  await expect(dialog).toBeHidden();
  await expect(host.locator('[data-screen="title"]')).toBeVisible();
  await expect(host.getByTestId('btn-mode-solo')).toBeFocused();

  expect(hostErrors).toEqual([]);
  await context.close();
});

test('neither device can see the other fleet while it is still afloat', async ({ browser }) => {
  const { context, host, guest, hostErrors, guestErrors } = await openTable(browser);
  const code = await createGame(host);

  await guest.getByTestId('btn-mode-online').click();
  await guest.getByTestId('input-room-code').fill(code);
  await guest.getByTestId('btn-join-game').click();
  await bothPlace(host, guest);

  // Nothing is known about the enemy tray before the first shot.
  await expect(host.locator('.screen__enemy .hull')).toHaveCount(0);
  await expect(guest.locator('.screen__enemy .hull')).toHaveCount(0);

  // Play a stretch of the game, checking after every exchange that each page
  // still only draws the hulls it has earned.
  for (let round = 0; round < 60; round++) {
    if ((await isOver(host)) || (await isOver(guest))) break;
    const firedHost = await fireOne(host);
    const firedGuest = await fireOne(guest);
    if (!firedHost && !firedGuest) await host.waitForTimeout(20);
    await expectNoFleetLeak(host);
    await expectNoFleetLeak(guest);
  }

  // And the shots really happened: this was not sixty rounds of nothing.
  await expect(host.locator('.log__list .log__line').first()).toBeVisible();

  expect(hostErrors).toEqual([]);
  expect(guestErrors).toEqual([]);
  await context.close();
});

test('the result card is never a dead end', async ({ browser }) => {
  const { context, host, guest, hostErrors, guestErrors } = await openTable(browser);
  const code = await createGame(host);

  await guest.getByTestId('btn-mode-online').click();
  await guest.getByTestId('input-room-code').fill(code);
  await guest.getByTestId('btn-join-game').click();
  await bothPlace(host, guest);
  await playToTheEnd(host, guest);

  await expect(host.getByTestId('result')).toHaveText(/^(Victory|Defeat)$/);
  const hostWon = (await host.getByTestId('result').textContent()) === 'Victory';
  const winner = hostWon ? host : guest;
  const loser = hostWon ? guest : host;
  await winner.getByTestId('btn-skip-video').click();

  // An opponent who never answers a rematch must not strand anyone: the card
  // is modal, so it carries its own way out.
  await winner.getByTestId('btn-play-again').click();
  await expect(winner.getByTestId('btn-play-again')).toBeDisabled();
  await winner.getByTestId('btn-leave').click();
  await expect(winner.locator('[data-screen="title"]')).toBeVisible();
  await expect(winner.getByTestId('disconnect')).toBeHidden();

  // And the other device is told, rather than left waiting.
  await expect(loser.getByTestId('disconnect-title')).toHaveText('Your opponent left the game');

  expect(hostErrors).toEqual([]);
  expect(guestErrors).toEqual([]);
  await context.close();
});

test('a room code that is not one is refused before anything connects', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = trackConsole(page);
  await page.goto('/?transport=local&fast=1');

  await page.getByTestId('btn-mode-online').click();
  await expect(page.getByTestId('btn-create-game')).toBeFocused();

  const input = page.getByTestId('input-room-code');
  const error = page.getByTestId('code-error');
  await input.fill('ABC');
  await page.getByTestId('btn-join-game').click();
  await expect(error).toHaveText('A room code is 6 letters and numbers, like ABC234.');
  await expect(page.locator('[data-screen="lobby"]')).toBeVisible();

  // Typing again clears the complaint.
  await input.pressSequentially('234');
  await expect(error).toBeHidden();
  await expect(input).toHaveValue('ABC234');

  // The alphabet has no O and no 0 to confuse (N8).
  await input.fill('ABCDEO');
  await page.getByTestId('btn-join-game').click();
  await expect(error).toBeVisible();

  // Back goes to the title, and "Play vs computer" still works.
  await page.getByTestId('btn-back').click();
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  await page.getByTestId('btn-mode-solo').click();
  await expect(page.locator('[data-screen="placement"]')).toBeVisible();

  expect(errors).toEqual([]);
  await context.close();
});
