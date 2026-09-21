/**
 * "No network requests" is a promise the game makes to a solo player (Decision
 * N1), and adding an online mode is exactly the change that could break it
 * quietly. So this spec watches the wire rather than the screen: it plays the
 * first few moves of a game against the computer with every request, every
 * websocket and every `RTCPeerConnection` under observation, and fails if any
 * of them leaves the machine.
 *
 * The PeerJS transport is behind a dynamic `import()`, which the single-file
 * build keeps as a one-shot initializer — the module body, including PeerJS's
 * WebRTC feature probe, only runs when someone creates a peer transport. The
 * `RTCPeerConnection` counter below is what holds that true over time.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Anything the page asks for that is not part of the single file we served. */
function watchNetwork(page: Page, origin: string): { offsite: string[]; sockets: string[] } {
  const offsite: string[] = [];
  const sockets: string[] = [];

  page.on('request', (request) => {
    const url = new URL(request.url());
    // `data:` and `blob:` are the inlined artwork and the victory clip: they
    // never leave the process.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.origin === origin) return;
    offsite.push(request.url());
  });
  page.on('websocket', (socket) => sockets.push(socket.url()));

  return { offsite, sockets };
}

/** Counts every `RTCPeerConnection` the page builds, from before the first script runs. */
async function watchWebRTC(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = window as unknown as {
      __rtcPeerConnections: number;
      RTCPeerConnection?: typeof RTCPeerConnection;
    };
    scope.__rtcPeerConnections = 0;
    const original = scope.RTCPeerConnection;
    if (!original) return;
    scope.RTCPeerConnection = new Proxy(original, {
      construct(target, args: ConstructorParameters<typeof RTCPeerConnection>) {
        scope.__rtcPeerConnections += 1;
        return new target(...args);
      },
    });
  });
}

async function peerConnectionCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __rtcPeerConnections: number }).__rtcPeerConnections,
  );
}

const FIREABLE = '[data-testid^="enemy-cell-"][data-fireable="true"]';

/**
 * Title → placement, whichever way the title offers it: "Play" today, "Play vs
 * computer" once the mode step lands. This spec is about the wire, not about
 * the route, so it takes whichever of the two is on screen.
 */
async function startSolo(page: Page): Promise<void> {
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  const placement = page.locator('[data-screen="placement"]');

  for (let click = 0; click < 2 && (await placement.count()) === 0; click++) {
    const solo = page.getByTestId('btn-mode-solo');
    const button = (await solo.count()) > 0 ? solo : page.getByTestId('btn-play');
    await button.click();
    await page.locator('[data-screen="placement"], [data-screen="mode"]').first().waitFor();
  }

  await expect(placement).toBeVisible();
}

test('the title screen talks to nobody', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin;
  await watchWebRTC(page);
  const seen = watchNetwork(page, origin);

  await page.goto('/');
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  // Long enough for anything deferred (fonts, a stray fetch, a broker socket).
  await page.waitForTimeout(1000);

  expect(seen.offsite, 'the title screen made no off-site request').toEqual([]);
  expect(seen.sockets, 'the title screen opened no websocket').toEqual([]);
  expect(await peerConnectionCount(page), 'no RTCPeerConnection was built').toBe(0);
});

test('a game against the computer opens no connection of any kind', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin;
  await watchWebRTC(page);
  const seen = watchNetwork(page, origin);

  await page.goto('/?seed=7&fast=1');
  await startSolo(page);

  await page.getByTestId('btn-random').click();
  await page.getByTestId('btn-start').click();
  await expect(page.locator('[data-screen="battle"]')).toBeVisible();

  // A few full rounds: my shot, the computer's answer, back to me.
  for (let shot = 0; shot < 4; shot++) {
    const cell = page.locator(FIREABLE).first();
    await cell.waitFor();
    await cell.click();
  }
  await page.locator(FIREABLE).first().waitFor();

  expect(seen.offsite, 'a solo game made no off-site request').toEqual([]);
  expect(seen.sockets, 'a solo game opened no websocket').toEqual([]);
  expect(await peerConnectionCount(page), 'no RTCPeerConnection was built').toBe(0);
});
