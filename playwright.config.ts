import { defineConfig } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * The smoke test runs against the real single-file build served by
 * `vite preview` (port 4173, strictPort), so it exercises exactly what ships.
 * `reuseExistingServer: false` guarantees a fresh build every run.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    // Headless Chromium has no audio device; the WebAudio graph still runs.
    launchOptions: { args: ['--mute-audio'] },
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
