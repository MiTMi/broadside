/**
 * The spend-critical orchestration: probe, estimate and generate.
 *
 * Every guard from PLAN P5 lives here and is unit-tested with an injected
 * `fetch` and clock:
 *   - an asset whose original already exists is never regenerated (P1);
 *   - estimates run first and a failed estimate aborts before any paid call;
 *   - the summed estimate is checked against `--max-usd` before the first POST;
 *   - `--yes` is required before anything is submitted (extra belt on top of
 *     the plan: without it the run prints the bill and exits cleanly);
 *   - requests are sequential; submits are never retried;
 *   - the manifest is flushed after every asset.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CliError } from './errors.mjs';
import { downloadImage, estimate, listModels, pollUntilDone, submitJob } from './api.mjs';
import { DEFAULT_MAX_USD, PROBE_ASSET, PROBE_MODELS, getModel } from './config.mjs';
import { relativeToRoot, writeManifestEntry } from './manifest.mjs';

/**
 * @typedef {import('./api.mjs').ApiCtx & {
 *   paths: import('./config.mjs').Paths,
 *   processAsset?: (asset: import('./config.mjs').Asset) => Promise<{ path: string, bytes: number } | null>,
 * }} PipelineCtx
 */

/**
 * The paid original for `name`, whatever extension it was downloaded with.
 *
 * @param {import('./config.mjs').Paths} paths
 * @param {string} name
 * @returns {string | null}
 */
export function findOriginal(paths, name) {
  /** @type {string[]} */
  let entries;
  try {
    entries = fs.readdirSync(paths.originalDir);
  } catch {
    return null;
  }
  const match = entries.find((file) => file.slice(0, file.length - path.extname(file).length) === name);
  return match ? path.join(paths.originalDir, match) : null;
}

/**
 * @param {PipelineCtx} ctx
 * @param {readonly import('./config.mjs').Asset[]} assets
 * @param {boolean} redo
 * @returns {{ skipped: string[], pending: { asset: import('./config.mjs').Asset, existing: string | null, body?: Record<string, unknown>, usd?: number }[] }}
 */
function buildPlan(ctx, assets, redo) {
  /** @type {string[]} */
  const skipped = [];
  /** @type {{ asset: import('./config.mjs').Asset, existing: string | null }[]} */
  const pending = [];

  for (const asset of assets) {
    const existing = findOriginal(ctx.paths, asset.name);
    if (existing && !redo) {
      skipped.push(asset.name);
      continue;
    }
    pending.push({ asset, existing });
  }
  return { skipped, pending };
}

/**
 * Price every pending asset. A single failure aborts the whole run before any
 * money can be spent (PLAN P5).
 *
 * @param {PipelineCtx} ctx
 * @param {{ asset: import('./config.mjs').Asset, existing: string | null, body?: Record<string, unknown>, usd?: number }[]} pending
 * @param {import('./config.mjs').Model} model
 * @returns {Promise<number>} total USD
 */
async function priceAll(ctx, pending, model) {
  let total = 0;
  for (const item of pending) {
    item.body = model.buildBody(item.asset);
    try {
      const result = await estimate(ctx, model.path, item.body);
      item.usd = result.usd;
      total += result.usd;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new CliError(`${message} Aborting: without a price for every asset nothing is submitted, so nothing was charged.`);
    }
  }
  return total;
}

/**
 * `--estimate`: free. Prices the assets that would be generated and says which
 * ones already exist.
 *
 * @param {PipelineCtx} ctx
 * @param {{ assets: readonly import('./config.mjs').Asset[], modelPath: string }} options
 * @returns {Promise<{ rows: { name: string, usd: number }[], total: number, skipped: string[] }>}
 */
export async function runEstimate(ctx, options) {
  const model = getModel(options.modelPath);
  const { skipped, pending } = buildPlan(ctx, options.assets, false);

  if (skipped.length > 0) ctx.log(`Already generated (would be skipped): ${skipped.join(', ')}`);
  if (pending.length === 0) {
    ctx.log('Nothing to estimate — every requested asset already has an original.');
    return { rows: [], total: 0, skipped };
  }

  const total = await priceAll(ctx, pending, model);
  ctx.log(`Estimate with ${model.path}:`);
  const rows = pending.map((item) => ({ name: item.asset.name, usd: item.usd ?? 0 }));
  for (const row of rows) ctx.log(`  ${row.name.padEnd(16)} $${row.usd.toFixed(3)}`);
  ctx.log(`  ${'TOTAL'.padEnd(16)} $${total.toFixed(2)} for ${rows.length} asset(s) — no money was spent by this command.`);
  return { rows, total, skipped };
}

/**
 * `--generate` / `--redo`: the only mode that can spend money.
 *
 * @param {PipelineCtx} ctx
 * @param {{
 *   assets: readonly import('./config.mjs').Asset[],
 *   modelPath: string,
 *   maxUsd?: number,
 *   yes?: boolean,
 *   redo?: boolean,
 *   intervalMs?: number,
 *   timeoutMs?: number,
 * }} options
 * @returns {Promise<{ generated: { name: string, requestId: string, usd: number, original: string }[], skipped: string[], totalUsd: number, dryRun: boolean }>}
 */
export async function runGenerate(ctx, options) {
  const model = getModel(options.modelPath);
  const maxUsd = options.maxUsd ?? DEFAULT_MAX_USD;
  const redo = options.redo ?? false;
  const { skipped, pending } = buildPlan(ctx, options.assets, redo);

  if (skipped.length > 0) ctx.log(`Already generated, skipping (never regenerated without --redo): ${skipped.join(', ')}`);
  if (pending.length === 0) {
    ctx.log('Nothing to generate — every requested asset already has an original.');
    return { generated: [], skipped, totalUsd: 0, dryRun: false };
  }

  const total = await priceAll(ctx, pending, model);

  ctx.log(`About to pay for ${pending.length} asset(s) with ${model.path}:`);
  for (const item of pending) ctx.log(`  ${item.asset.name.padEnd(16)} $${(item.usd ?? 0).toFixed(3)}`);
  ctx.log(`  ${'TOTAL'.padEnd(16)} $${total.toFixed(2)}   (cap --max-usd $${maxUsd.toFixed(2)})`);

  if (total > maxUsd) {
    throw new CliError(
      `Estimated total $${total.toFixed(2)} exceeds the --max-usd cap of $${maxUsd.toFixed(2)}. Nothing was submitted and nothing was charged. Raise the cap deliberately if this is expected.`,
    );
  }

  if (!options.yes) {
    ctx.log('Dry run: --yes was not passed, so nothing was submitted and nothing was charged.');
    ctx.log('Re-run the exact same command with --yes to spend the total above.');
    return { generated: [], skipped, totalUsd: total, dryRun: true };
  }

  /** @type {{ name: string, requestId: string, usd: number, original: string }[]} */
  const generated = [];
  for (const item of pending) {
    generated.push(await generateOne(ctx, item, model, options));
  }
  ctx.log(`Done: ${generated.length} asset(s) generated for an estimated $${total.toFixed(2)}.`);
  return { generated, skipped, totalUsd: total, dryRun: false };
}

/**
 * @param {PipelineCtx} ctx
 * @param {{ asset: import('./config.mjs').Asset, existing: string | null, body?: Record<string, unknown>, usd?: number }} item
 * @param {import('./config.mjs').Model} model
 * @param {{ intervalMs?: number, timeoutMs?: number }} options
 * @returns {Promise<{ name: string, requestId: string, usd: number, original: string }>}
 */
async function generateOne(ctx, item, model, options) {
  const { asset } = item;
  const body = item.body ?? model.buildBody(asset);
  const nowIso = () => new Date(ctx.now()).toISOString();

  // Only now — after estimate, cap and --yes — is the old original retired, so
  // a dry run can never leave the tree in a state that costs money next time.
  if (item.existing) {
    fs.mkdirSync(ctx.paths.replacedDir, { recursive: true });
    const ext = path.extname(item.existing);
    const stamp = nowIso().replace(/[:.]/g, '-');
    const target = path.join(ctx.paths.replacedDir, `${asset.name}.${stamp}${ext}`);
    fs.renameSync(item.existing, target);
    ctx.log(`  moved the previous original to ${relativeToRoot(ctx.paths, target)}`);
  }

  ctx.log(`${asset.name}: submitting to ${model.path}…`);
  const { requestId, statusUrl } = await submitJob(ctx, model.path, body);
  ctx.log(`  request_id=${requestId}`);

  const { imageUrl } = await pollUntilDone(ctx, requestId, {
    statusUrl,
    ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });

  let download;
  try {
    download = await downloadImage(ctx, imageUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError(`${message} The job was PAID and completed — recover it by hand from request_id=${requestId} before re-running.`);
  }
  if (download.ext === '.bin') ctx.log('  warning: unrecognised image format; the bytes were saved verbatim as .bin');

  fs.mkdirSync(ctx.paths.originalDir, { recursive: true });
  const originalPath = path.join(ctx.paths.originalDir, `${asset.name}${download.ext}`);
  fs.writeFileSync(originalPath, download.bytes);
  ctx.log(`  saved ${relativeToRoot(ctx.paths, originalPath)} (${download.bytes.length} bytes)`);

  /** @type {import('./manifest.mjs').ManifestEntry} */
  const entry = {
    name: asset.name,
    model: model.path,
    body,
    request_id: requestId,
    created_at: nowIso(),
    usd_estimate: item.usd ?? 0,
    original: relativeToRoot(ctx.paths, originalPath),
    optimized: null,
    bytes: download.bytes.length,
  };
  writeManifestEntry(ctx.paths, entry, nowIso);

  if (ctx.processAsset) {
    try {
      const processed = await ctx.processAsset(asset);
      if (processed) {
        entry.optimized = relativeToRoot(ctx.paths, processed.path);
        writeManifestEntry(ctx.paths, entry, nowIso);
        ctx.log(`  processed → ${entry.optimized} (${processed.bytes} bytes)`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.log(`  processing failed (the paid original is safe): ${ctx.redact(message)} — re-run npm run assets:process`);
    }
  }

  return { name: asset.name, requestId, usd: item.usd ?? 0, original: originalPath };
}

/**
 * `--probe`: free. Lists the account's image models and estimates a tiny job
 * on each candidate path so we know which ones this key may call (PLAN P4,
 * DECISIONS D5).
 *
 * @param {PipelineCtx} ctx
 * @param {{ models?: readonly string[] }} [options]
 * @returns {Promise<{ path: string, ok: boolean, usd: number | null, error: string | null }[]>}
 */
export async function runProbe(ctx, options = {}) {
  try {
    const models = await listModels(ctx);
    const images = models.filter((m) => m.outputType === '' || m.outputType.includes('image'));
    ctx.log(`GET /models — ${images.length} image model(s) on this account:`);
    for (const m of images) ctx.log(`  ${m.slug}${m.title ? ` — ${m.title}` : ''}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log(`GET /models failed (not fatal): ${ctx.redact(message)}`);
  }

  /** @type {{ path: string, ok: boolean, usd: number | null, error: string | null }[]} */
  const rows = [];
  for (const modelPath of options.models ?? PROBE_MODELS) {
    const model = getModel(modelPath);
    try {
      const result = await estimate(ctx, modelPath, model.buildBody(PROBE_ASSET));
      rows.push({ path: modelPath, ok: true, usd: result.usd, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      rows.push({ path: modelPath, ok: false, usd: null, error: ctx.redact(message) });
    }
  }

  ctx.log('Candidate model paths (free estimate calls only):');
  for (const row of rows) {
    ctx.log(`  ${row.ok ? 'OK ' : 'ERR'} ${row.path.padEnd(38)} ${row.ok ? `$${(row.usd ?? 0).toFixed(3)}` : row.error}`);
  }
  return rows;
}
