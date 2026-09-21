/**
 * The Higgsfield HTTP surface (PLAN P4/P5), behind an injected `fetch`, `sleep`
 * and `now` so every path is unit-testable without a network or a key.
 *
 * Money rules baked in here:
 *  - `submitJob` is NEVER retried (a retried POST can be charged twice);
 *  - `pollUntilDone` DOES retry read-only GETs, because they are free;
 *  - nothing built from a response or a network error reaches a message
 *    without passing through `ctx.redact`.
 */

import { CliError } from './errors.mjs';
import { POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from './config.mjs';

/**
 * @typedef {object} ApiCtx
 * @property {typeof globalThis.fetch} fetch
 * @property {(ms: number) => Promise<void>} sleep
 * @property {() => number} now
 * @property {(message: string) => void} log
 * @property {import('./errors.mjs').Redactor} redact
 * @property {string} authHeader
 * @property {string} base
 */

/**
 * @param {ApiCtx} ctx
 * @returns {Record<string, string>}
 */
function jsonHeaders(ctx) {
  return { Authorization: ctx.authHeader, 'Content-Type': 'application/json', Accept: 'application/json' };
}

/**
 * One fetch, with network errors turned into redacted CliErrors. No retry:
 * retrying is a per-call decision made by the callers below.
 *
 * @param {ApiCtx} ctx
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} what
 * @returns {Promise<Response>}
 */
async function once(ctx, url, init, what) {
  try {
    return await ctx.fetch(url, init);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CliError(`${what}: network error — ${ctx.redact(detail)}`);
  }
}

/**
 * @param {Response} res
 * @returns {Promise<string>} the raw body, or '' if it cannot be read.
 */
async function bodyText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * @param {ApiCtx} ctx
 * @param {string} text
 * @returns {string} a short, redacted excerpt safe to put in a message.
 */
function excerpt(ctx, text) {
  // Redact BEFORE truncating: slicing first could cut a credential in half and
  // leave a prefix the redactor no longer recognises.
  return ctx.redact(text).replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * @param {ApiCtx} ctx
 * @param {Response} res
 * @param {string} what
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJson(ctx, res, what) {
  const text = await bodyText(res);
  try {
    return /** @type {Record<string, unknown>} */ (JSON.parse(text));
  } catch {
    throw new CliError(`${what}: expected JSON, got HTTP ${res.status} "${excerpt(ctx, text)}"`);
  }
}

/**
 * Free cost estimate — no spend (PLAN P4).
 *
 * @param {ApiCtx} ctx
 * @param {string} modelPath
 * @param {Record<string, unknown>} body
 * @returns {Promise<{ usd: number, credits: string | null }>}
 */
export async function estimate(ctx, modelPath, body) {
  const what = `Estimate for ${modelPath}`;
  const res = await once(
    ctx,
    `${ctx.base}/estimate/${modelPath}`,
    { method: 'POST', headers: jsonHeaders(ctx), body: JSON.stringify(body) },
    what,
  );
  if (!res.ok) throw new CliError(`${what} failed with HTTP ${res.status}: ${excerpt(ctx, await bodyText(res))}`);

  const json = await readJson(ctx, res, what);
  const usd = Number(json['usd']);
  if (!Number.isFinite(usd)) throw new CliError(`${what} returned no usable "usd" field.`);
  return { usd, credits: typeof json['credits'] === 'string' ? json['credits'] : null };
}

/**
 * Submit a paid job. Deliberately NOT retried on 429/5xx (PLAN P5): a second
 * POST may create — and charge for — a second job.
 *
 * @param {ApiCtx} ctx
 * @param {string} modelPath
 * @param {Record<string, unknown>} body
 * @returns {Promise<{ requestId: string, statusUrl: string | null }>}
 */
export async function submitJob(ctx, modelPath, body) {
  const what = `Submit to ${modelPath}`;
  const res = await once(
    ctx,
    `${ctx.base}/${modelPath}`,
    { method: 'POST', headers: jsonHeaders(ctx), body: JSON.stringify(body) },
    what,
  );
  if (!res.ok) {
    throw new CliError(
      `${what} failed with HTTP ${res.status}: ${excerpt(ctx, await bodyText(res))} — not retried on purpose (a retried submit can be charged twice). Re-run the command when you are ready.`,
    );
  }

  const json = await readJson(ctx, res, what);
  const requestId = typeof json['request_id'] === 'string' ? json['request_id'] : '';
  if (!requestId) throw new CliError(`${what} returned no request_id; assume it may have been charged and check the dashboard.`);
  return { requestId, statusUrl: typeof json['status_url'] === 'string' ? json['status_url'] : null };
}

/**
 * Poll `GET /requests/{id}/status` until the job resolves. GETs are free, so
 * transport errors and 5xx are treated as "still pending" and retried on the
 * next tick; `failed` / `nsfw` stop immediately (both are refunded); the
 * timeout stops WITHOUT resubmitting and names the request_id so the paid
 * result can still be collected by hand.
 *
 * @param {ApiCtx} ctx
 * @param {string} requestId
 * @param {{ intervalMs?: number, timeoutMs?: number, statusUrl?: string | null }} [options]
 * @returns {Promise<{ imageUrl: string, status: Record<string, unknown> }>}
 */
export async function pollUntilDone(ctx, requestId, options = {}) {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? POLL_TIMEOUT_MS;
  const startedAt = ctx.now();
  // Prefer the status_url the API handed back, but only if it is on our own
  // host — never follow an arbitrary URL while carrying the Authorization header.
  const url =
    options.statusUrl && options.statusUrl.startsWith(`${ctx.base}/`)
      ? options.statusUrl
      : `${ctx.base}/requests/${requestId}/status`;

  for (;;) {
    const status = await readStatus(ctx, url, requestId);

    if (status) {
      const state = String(status['status'] ?? '');
      if (state === 'completed') {
        const imageUrl = firstImageUrl(status);
        if (!imageUrl) throw new CliError(`Job ${requestId} completed but carried no image URL.`);
        return { imageUrl, status };
      }
      if (state === 'failed' || state === 'nsfw') {
        const reason = typeof status['error'] === 'string' ? `: ${ctx.redact(status['error'])}` : '';
        throw new CliError(
          `Job ${requestId} ended as "${state}"${reason} (the docs say this is refunded). Stopping — nothing is resubmitted automatically.`,
        );
      }
    }

    if (ctx.now() - startedAt >= timeoutMs) {
      throw new CliError(
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for request_id=${requestId}. It was NOT resubmitted; check that id on the dashboard before spending again.`,
      );
    }
    await ctx.sleep(intervalMs);
  }
}

/**
 * @param {ApiCtx} ctx
 * @param {string} url
 * @param {string} requestId
 * @returns {Promise<Record<string, unknown> | null>} null means "retry later".
 */
async function readStatus(ctx, url, requestId) {
  let res;
  try {
    res = await ctx.fetch(url, { method: 'GET', headers: jsonHeaders(ctx) });
  } catch {
    return null; // transport hiccup on a free GET — try again on the next tick
  }
  if (res.status >= 500 || res.status === 429) return null;
  if (!res.ok) {
    throw new CliError(
      `Status check for request_id=${requestId} failed with HTTP ${res.status}: ${excerpt(ctx, await bodyText(res))} — the job may already have been paid for.`,
    );
  }

  const text = await bodyText(res);
  try {
    return /** @type {Record<string, unknown>} */ (JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown>} status
 * @returns {string | null}
 */
function firstImageUrl(status) {
  const images = status['images'];
  if (Array.isArray(images)) {
    for (const image of images) {
      if (typeof image === 'string') return image;
      if (image && typeof image === 'object' && typeof (/** @type {{url?: unknown}} */ (image).url) === 'string') {
        return /** @type {{url: string}} */ (image).url;
      }
    }
  }
  return null;
}

/**
 * Download the produced image. Output URLs expire (~7 days), so this runs
 * immediately after completion and the bytes are written verbatim.
 *
 * @param {ApiCtx} ctx
 * @param {string} url
 * @returns {Promise<{ bytes: Buffer, ext: string }>}
 */
export async function downloadImage(ctx, url) {
  const res = await once(ctx, url, { method: 'GET' }, 'Download');
  if (!res.ok) throw new CliError(`Download failed with HTTP ${res.status}.`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const contentType = typeof res.headers?.get === 'function' ? res.headers.get('content-type') : null;
  return { bytes, ext: detectImageExtension(bytes, contentType) };
}

/**
 * Magic bytes first (authoritative), content-type as a fallback. An unknown
 * format still gets written — it is paid for — under `.bin`.
 *
 * @param {Buffer | Uint8Array} bytes
 * @param {string | null | undefined} contentType
 * @returns {string} an extension including the dot
 */
export function detectImageExtension(bytes, contentType) {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return '.png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return '.webp';
  }

  const type = (contentType ?? '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  if (type.includes('webp')) return '.webp';
  return '.bin';
}

/**
 * `GET /models?limit=200` — free. Used by `--probe` to show what this account
 * can actually call (DECISIONS D5).
 *
 * @param {ApiCtx} ctx
 * @returns {Promise<{ slug: string, title: string, outputType: string }[]>}
 */
export async function listModels(ctx) {
  const what = 'List models';
  const res = await once(ctx, `${ctx.base}/models?limit=200`, { method: 'GET', headers: jsonHeaders(ctx) }, what);
  if (!res.ok) throw new CliError(`${what} failed with HTTP ${res.status}: ${excerpt(ctx, await bodyText(res))}`);
  const json = await readJson(ctx, res, what);
  const items = Array.isArray(json) ? json : Array.isArray(json['items']) ? json['items'] : (json['models'] ?? []);
  if (!Array.isArray(items)) return [];

  return items
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      slug: String(/** @type {Record<string, unknown>} */ (item)['slug'] ?? ''),
      title: String(/** @type {Record<string, unknown>} */ (item)['title'] ?? ''),
      outputType: String(/** @type {Record<string, unknown>} */ (item)['output_type'] ?? ''),
    }))
    .filter((item) => item.slug !== '');
}
