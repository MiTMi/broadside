/**
 * Test doubles for the asset pipeline: a recording `fetch`, a fake clock, a
 * throw-away project tree and a context wired to a FAKE credential.
 *
 * No test in this directory may touch the network or the real .env.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { API_BASE, createPaths } from '../../scripts/lib/config.mjs';
import { resolveCredentials } from '../../scripts/lib/credentials.mjs';

/** A fake credential, shaped like the real one ("<key-id>:<key-secret>"). */
export const FAKE_KEY_ID = 'fake-key-id-4a8f';
export const FAKE_SECRET = 'fake-secret-NEVER-LOG-ME-1234567890';
export const FAKE_CREDENTIAL = `${FAKE_KEY_ID}:${FAKE_SECRET}`;

/** @returns {{ now: () => number, sleep: (ms: number) => Promise<void>, ticks: number[] }} */
export function createClock() {
  let time = 0;
  /** @type {number[]} */
  const ticks = [];
  return {
    now: () => time,
    sleep: async (ms) => {
      ticks.push(ms);
      time += ms;
    },
    ticks,
  };
}

/**
 * @param {unknown} body
 * @param {{ status?: number, text?: string }} [options]
 * @returns {object} just enough of a Response for the code under test
 */
export function jsonResponse(body, options = {}) {
  const status = options.status ?? 200;
  const text = options.text ?? JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  };
}

/** A minimal but valid PNG header + payload. */
export const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-payload'),
]);

/**
 * @param {Buffer} bytes
 * @param {string} [contentType]
 * @returns {object}
 */
export function bytesResponse(bytes, contentType = 'image/png') {
  return {
    ok: true,
    status: 200,
    headers: { get: (/** @type {string} */ name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => bytes.toString('binary'),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

/**
 * A recording fetch. `handler(url, init, callIndex)` returns a response or
 * throws to simulate a transport failure.
 *
 * @param {(url: string, init: RequestInit, callIndex: number) => unknown} handler
 */
export function recordFetch(handler) {
  /** @type {{ url: string, method: string, body: unknown }[]} */
  const calls = [];
  const fn = /** @type {typeof globalThis.fetch & { calls: typeof calls, posts: (needle: string) => typeof calls }} */ (
    /** @type {unknown} */ (
      async (/** @type {string} */ url, /** @type {RequestInit} */ init = {}) => {
        calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body });
        return handler(String(url), init, calls.length - 1);
      }
    )
  );
  fn.calls = calls;
  fn.posts = (needle) => calls.filter((call) => call.method === 'POST' && call.url.includes(needle));
  return fn;
}

/**
 * A throw-away project root; the caller removes it in `afterEach`.
 *
 * @returns {import('../../scripts/lib/config.mjs').Paths}
 */
export function createTempPaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broadside-assets-'));
  const paths = createPaths(root);
  fs.mkdirSync(paths.originalDir, { recursive: true });
  return paths;
}

/** @param {import('../../scripts/lib/config.mjs').Paths} paths */
export function removeTempPaths(paths) {
  fs.rmSync(paths.root, { recursive: true, force: true });
}

/**
 * A pipeline context with a fake credential and no real network.
 *
 * @param {{ fetch: ReturnType<typeof recordFetch>, paths: import('../../scripts/lib/config.mjs').Paths, clock?: ReturnType<typeof createClock> }} options
 */
export function createCtx(options) {
  const clock = options.clock ?? createClock();
  const credentials = resolveCredentials({ HF_API_KEY: FAKE_CREDENTIAL });
  /** @type {string[]} */
  const logs = [];

  return {
    clock,
    logs,
    ctx: {
      fetch: options.fetch,
      sleep: clock.sleep,
      now: clock.now,
      log: (/** @type {string} */ message) => logs.push(credentials.redact(message)),
      redact: credentials.redact,
      authHeader: credentials.authHeader,
      base: API_BASE,
      paths: options.paths,
    },
  };
}

/**
 * @param {import('../../scripts/lib/config.mjs').Paths} paths
 * @param {string} name
 * @param {string} [ext]
 * @returns {string}
 */
export function writeFakeOriginal(paths, name, ext = '.png') {
  fs.mkdirSync(paths.originalDir, { recursive: true });
  const file = path.join(paths.originalDir, `${name}${ext}`);
  fs.writeFileSync(file, PNG_BYTES);
  return file;
}

/**
 * @param {string} url
 * @returns {string} the trailing model path of a submit/estimate URL
 */
export function tail(url) {
  return url.replace(`${API_BASE}/`, '');
}
