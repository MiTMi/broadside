/**
 * Sound has to be *audible*, and that is not something the DOM can tell us: an
 * earlier version of `sound.ts` played every cue correctly at about −30 dBFS,
 * which reads as "no sound at all" on a laptop speaker. So this test listens.
 *
 * Before any app code runs, `window.AudioContext` is wrapped so that anything
 * connecting to `ctx.destination` is routed through an AnalyserNode first. The
 * analyser passes the audio through unchanged and lets the page keep a running
 * peak of the real output, which the test resets around each cue.
 *
 * No `?fast=1` here: the CPU's normal 650–1000 ms pause is what keeps the
 * player's cue alone in the measurement window. `?seed=4` is chosen because,
 * after "Place randomly", the first enemy cell (A1) is a miss and the second
 * (A2) is a hit — one short cue and one long one, in two shots.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __audio: { reset: () => void; peak: () => number; state: () => string };
  }
}

/** Runs in the page before any app code: tees the output into an analyser. */
function installAudioTap(): void {
  const Original = window.AudioContext;
  if (!Original) return;

  const connectToNode = AudioNode.prototype.connect as (
    this: AudioNode,
    target: AudioNode,
    output?: number,
    input?: number,
  ) => AudioNode;
  const connectToParam = AudioNode.prototype.connect as (
    this: AudioNode,
    target: AudioParam,
    output?: number,
  ) => void;

  const analysers = new WeakMap<AudioNode, AnalyserNode>();
  const measured = { peak: 0, state: 'none' };

  window.__audio = {
    reset: (): void => {
      measured.peak = 0;
    },
    peak: (): number => measured.peak,
    state: (): string => measured.state,
  };

  window.AudioContext = class TappedAudioContext extends Original {
    constructor(options?: AudioContextOptions) {
      super(options);
      const analyser = this.createAnalyser();
      analyser.fftSize = 2048;
      // The native connect — the patch below would loop it onto itself.
      connectToNode.call(analyser, this.destination);
      analysers.set(this.destination, analyser);

      const samples = new Float32Array(analyser.fftSize);
      window.setInterval(() => {
        measured.state = this.state;
        analyser.getFloatTimeDomainData(samples);
        for (let i = 0; i < samples.length; i++) {
          const level = Math.abs(samples[i] ?? 0);
          if (level > measured.peak) measured.peak = level;
        }
      }, 16);
    }
  };

  function patchedConnect(this: AudioNode, target: AudioNode, output?: number, input?: number): AudioNode;
  function patchedConnect(this: AudioNode, target: AudioParam, output?: number): void;
  function patchedConnect(
    this: AudioNode,
    target: AudioNode | AudioParam,
    output?: number,
    input?: number,
  ): AudioNode | void {
    if (target instanceof AudioNode) {
      return connectToNode.call(this, analysers.get(target) ?? target, output, input);
    }
    return connectToParam.call(this, target, output);
  }
  AudioNode.prototype.connect = patchedConnect;
}

interface Sampled {
  /** Loudest sample in the first 400 ms after the action. */
  peak: number;
  /** Loudest sample from 400 ms to 620 ms — still before the CPU answers. */
  tail: number;
}

async function sample(page: Page, action: () => Promise<void>): Promise<Sampled> {
  await page.evaluate(() => {
    window.__audio.reset();
  });
  await action();
  await page.waitForTimeout(400);
  const peak = await page.evaluate(() => window.__audio.peak());
  await page.evaluate(() => {
    window.__audio.reset();
  });
  await page.waitForTimeout(220);
  const tail = await page.evaluate(() => window.__audio.peak());
  return { peak, tail };
}

/** Fires the next available enemy cell and reports what it turned out to be. */
async function fire(page: Page): Promise<Sampled & { state: string | null }> {
  const cell = page.locator('[data-testid^="enemy-cell-"][data-fireable="true"]').first();
  await cell.waitFor();
  const id = await cell.getAttribute('data-testid');
  const measurement = await sample(page, () => cell.click());
  const state = await page.locator(`[data-testid="${id ?? ''}"]`).getAttribute('data-state');
  return { ...measurement, state };
}

/** Full scale. Nothing may reach it, however many cues overlap. */
const CEILING = 1;

test('every cue is loud enough to hear, and nothing clips', async ({ page }) => {
  await page.addInitScript(installAudioTap);
  await page.goto('/?seed=4');

  // "Play" is the first gesture of the session: it both starts the audio
  // context and plays the quietest cue in the game.
  const select = await sample(page, () => page.getByTestId('btn-play').click());
  expect(await page.evaluate(() => window.__audio.state())).toBe('running');

  const place = await sample(page, () => page.getByTestId('btn-random').click());
  const start = await sample(page, () => page.getByTestId('btn-start').click());

  const miss = await fire(page);
  // Let the enemy take its turn and go quiet again before the next measurement.
  await page.locator('[data-testid^="enemy-cell-"][data-fireable="true"]').first().waitFor();
  await page.waitForTimeout(1000);
  const hit = await fire(page);

  const peaks = { select, place, start, miss, hit };
  // Printed by the list reporter: the numbers are the point of this test.
  console.log('cue peaks', JSON.stringify(peaks));

  expect(miss.state, 'seed 4 fires A1 into open water').toBe('miss');
  expect(hit.state, 'seed 4 then hits at A2').toMatch(/hit|sunk/);

  // Audible: a peg drop is a small sound, a shot is not.
  expect(select.peak, 'select is quiet, but not inaudible').toBeGreaterThan(0.06);
  expect(place.peak, 'placing a ship').toBeGreaterThan(0.15);
  expect(start.peak, 'battle start').toBeGreaterThan(0.15);
  expect(miss.peak, 'a splash').toBeGreaterThan(0.15);
  expect(hit.peak, 'a shell landing').toBeGreaterThan(0.3);

  // Balanced: select stays clearly the quietest, a hit beats a miss.
  expect(select.peak).toBeLessThan(place.peak);
  expect(miss.peak).toBeLessThan(hit.peak);

  // Never clipping.
  for (const [name, cue] of Object.entries(peaks)) {
    expect(cue.peak, `${name} must stay under full scale`).toBeLessThanOrEqual(CEILING);
  }

  // Shaped: the explosion is still ringing after 400 ms, while the short cues
  // are long gone — this is what makes a hit read as an impact, not a click.
  // The miss is a recorded splash now (~1.1 s of water settling), so it rings on
  // too; the interface cues are what must stay short.
  expect(hit.tail, 'a hit keeps burning').toBeGreaterThan(0.01);
  expect(miss.tail, 'a recorded splash is still settling').toBeGreaterThan(0.01);
  expect(place.tail, 'placing a ship is a short knock').toBeLessThan(0.01);
  expect(select.tail, 'select does not ring on').toBeLessThan(0.005);
});

test('muting silences the output and survives a reload', async ({ page }) => {
  await page.addInitScript(installAudioTap);
  await page.goto('/?seed=4');

  await page.getByTestId('btn-play').click();
  await page.getByTestId('btn-sound').click();
  await expect(page.getByTestId('btn-sound')).toHaveAttribute('aria-pressed', 'false');
  // Let the cue that played on the way in die away before measuring.
  await page.waitForTimeout(500);

  const muted = await sample(page, () => page.getByTestId('btn-random').click());
  expect(muted.peak, 'muted means silent').toBeLessThan(0.001);

  // The choice is persisted, and the header shows it on the next visit.
  await page.reload();
  await expect(page.getByTestId('btn-sound')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('btn-play').click();
  const stillMuted = await sample(page, () => page.getByTestId('btn-random').click());
  expect(stillMuted.peak, 'still muted after a reload').toBeLessThan(0.001);

  await page.getByTestId('btn-sound').click();
  await expect(page.getByTestId('btn-sound')).toHaveAttribute('aria-pressed', 'true');
  const unmuted = await sample(page, async () => {
    await page.getByTestId('btn-clear').click();
    await page.getByTestId('btn-random').click();
  });
  expect(unmuted.peak, 'unmuted plays again').toBeGreaterThan(0.15);
});
