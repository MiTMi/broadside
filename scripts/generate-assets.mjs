#!/usr/bin/env node
/**
 * Broadside asset pipeline — the ONLY thing in this repo that talks to
 * Higgsfield, and only when you ask it to spend (PLAN P1–P7).
 *
 *   npm run assets:probe                    free  — which models this key may call
 *   npm run assets:estimate                 free  — per-asset + total USD
 *   npm run assets:generate                 PAID  — prints the bill; needs --yes
 *   npm run assets:redo -- <name> --yes     PAID  — regenerate one asset
 *   npm run assets:process                  free  — originals → src/assets
 *   npm run assets:placeholders             free  — local stand-in art
 *
 * Credentials come from the environment only (node --env-file=.env); this
 * script never opens .env and never prints a credential.
 */

import path from 'node:path';
import process from 'node:process';

import { API_BASE, ASSETS, DEFAULT_MAX_USD, DEFAULT_MODEL, createPaths, selectAssets } from './lib/config.mjs';
import { CliError, noRedact, redactError } from './lib/errors.mjs';
import { resolveCredentials } from './lib/credentials.mjs';
import { runEstimate, runGenerate, runProbe } from './lib/pipeline.mjs';
import { processAsset, runProcess } from './lib/process.mjs';
import { runPlaceholders } from './lib/placeholders.mjs';

/** Set as soon as credentials are resolved, so late errors are redacted too. */
let activeRedact = noRedact;

const MODES = ['probe', 'estimate', 'generate', 'redo', 'process', 'placeholders'];
const NEEDS_CREDENTIALS = new Set(['probe', 'estimate', 'generate', 'redo']);

const USAGE = `Broadside asset pipeline

  node scripts/generate-assets.mjs --<mode> [names…] [options]

Modes
  --probe          free   list this account's image models and estimate each candidate path
  --estimate       free   price every asset that does not exist yet
  --generate       PAID   generate the missing assets (prints the bill; requires --yes to spend)
  --redo <name>    PAID   move the old original aside and regenerate one asset (requires --yes)
  --process        free   originals in assets/original → optimized files in src/assets
  --placeholders   free   draw local stand-in art for assets that have no optimized file yet

Options
  --yes            actually spend money (without it, --generate/--redo stop after printing the estimate)
  --model <path>   model path for --estimate/--generate/--redo (default ${DEFAULT_MODEL})
  --max-usd <n>    hard cap checked against the summed estimate before the first paid call (default ${DEFAULT_MAX_USD.toFixed(2)})
  --tolerance <n>  background-removal tolerance for --process, 0–1 (default 0.12)
  --force          --placeholders: overwrite existing optimized files
  --debug          print a (redacted) stack trace on an unexpected error
  --help           this text
`;

/**
 * @param {readonly string[]} argv
 * @returns {{ mode: string | null, names: string[], yes: boolean, force: boolean, debug: boolean, help: boolean, model: string, maxUsd: number, tolerance: number | undefined }}
 */
export function parseArgs(argv) {
  /** @type {string | null} */
  let mode = null;
  /** @type {string[]} */
  const names = [];
  let yes = false;
  let force = false;
  let debug = false;
  let help = false;
  let model = DEFAULT_MODEL;
  let maxUsd = DEFAULT_MAX_USD;
  /** @type {number | undefined} */
  let tolerance;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const flag = arg.startsWith('--') ? arg.slice(2) : null;

    if (flag === null) {
      names.push(arg);
      continue;
    }
    if (MODES.includes(flag)) {
      if (mode && mode !== flag) throw new CliError(`Pick one mode: --${mode} and --${flag} cannot be combined.`);
      mode = flag;
      continue;
    }
    switch (flag) {
      case 'yes':
        yes = true;
        break;
      case 'force':
        force = true;
        break;
      case 'debug':
        debug = true;
        break;
      case 'help':
        help = true;
        break;
      case 'model':
        model = requireValue(argv, ++i, '--model');
        break;
      case 'max-usd':
        maxUsd = requireNumber(argv, ++i, '--max-usd');
        break;
      case 'tolerance':
        tolerance = requireNumber(argv, ++i, '--tolerance');
        break;
      default:
        throw new CliError(`Unknown option "${arg}". Run with --help.`);
    }
  }

  return { mode, names, yes, force, debug, help, model, maxUsd, tolerance };
}

/**
 * @param {readonly string[]} argv
 * @param {number} index
 * @param {string} flag
 * @returns {string}
 */
function requireValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) throw new CliError(`${flag} needs a value.`);
  return value;
}

/**
 * @param {readonly string[]} argv
 * @param {number} index
 * @param {string} flag
 * @returns {number}
 */
function requireNumber(argv, index, flag) {
  const value = Number(requireValue(argv, index, flag));
  if (!Number.isFinite(value)) throw new CliError(`${flag} needs a number.`);
  return value;
}

/**
 * @param {ReturnType<typeof parseArgs>} options
 * @returns {Promise<void>}
 */
async function run(options) {
  const paths = createPaths();
  const log = (/** @type {string} */ message) => console.log(activeRedact(message));

  /** @type {import('./lib/config.mjs').Asset[]} */
  let assets;
  try {
    assets = selectAssets(options.names);
  } catch (err) {
    throw new CliError(err instanceof Error ? err.message : String(err));
  }

  if (!NEEDS_CREDENTIALS.has(options.mode ?? '')) {
    // --process / --placeholders: local, free, and they never read the env.
    const sharp = (await import('sharp')).default;
    const deps = {
      paths,
      sharp,
      log,
      force: options.force,
      ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }),
    };
    if (options.mode === 'placeholders') await runPlaceholders(deps, assets);
    else await runProcess(deps, assets);
    return;
  }

  const credentials = resolveCredentials(process.env);
  activeRedact = credentials.redact;

  const ctx = {
    fetch: globalThis.fetch,
    sleep: (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log,
    redact: credentials.redact,
    authHeader: credentials.authHeader,
    base: API_BASE,
    paths,
  };

  if (options.mode === 'probe') {
    await runProbe(ctx);
    return;
  }
  if (options.mode === 'estimate') {
    await runEstimate(ctx, { assets, modelPath: options.model });
    return;
  }

  // --generate / --redo: the paid paths.
  if (options.mode === 'redo' && options.names.length === 0) {
    throw new CliError(`--redo needs at least one asset name, e.g. "npm run assets:redo -- ${ASSETS[0]?.name} --yes".`);
  }

  const sharp = (await import('sharp')).default;
  const processDeps = {
    paths,
    sharp,
    log,
    ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }),
  };

  await runGenerate(
    { ...ctx, processAsset: (asset) => processAsset(processDeps, asset) },
    {
      assets,
      modelPath: options.model,
      maxUsd: options.maxUsd,
      yes: options.yes,
      redo: options.mode === 'redo',
    },
  );
}

/**
 * @param {readonly string[]} argv
 * @returns {Promise<void>}
 */
async function main(argv) {
  const options = parseArgs(argv);
  if (options.help || options.mode === null) {
    console.log(USAGE);
    if (options.mode === null && !options.help) throw new CliError('No mode given. Pick one of: --' + MODES.join(', --'));
    return;
  }
  if ((options.mode === 'generate' || options.mode === 'redo') && !options.yes) {
    console.log('Note: --yes was not passed; this run will stop after printing the estimate.');
  }
  await run(options);
}

// Only run when this file IS the command; the unit tests import parseArgs.
const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    const clean = redactError(err, activeRedact);
    const isExpected = err instanceof CliError;
    console.error(isExpected ? clean.message : `Unexpected error: ${clean.message} (re-run with --debug for the stack)`);
    if (process.argv.includes('--debug')) console.error(clean.stack);
    process.exitCode = 1;
  });
}
