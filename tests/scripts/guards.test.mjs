/**
 * PLAN P5 — the money guards. Every test here runs against an injected fetch
 * and a fake clock: nothing in this file can reach the network, and the
 * credential it uses is fake.
 */

import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ASSETS, DEFAULT_MODEL, selectAssets } from '../../scripts/lib/config.mjs';
import { findOriginal, runEstimate, runGenerate } from '../../scripts/lib/pipeline.mjs';
import { redactError } from '../../scripts/lib/errors.mjs';
import {
  FAKE_CREDENTIAL,
  FAKE_KEY_ID,
  FAKE_SECRET,
  PNG_BYTES,
  bytesResponse,
  createCtx,
  createTempPaths,
  jsonResponse,
  recordFetch,
  removeTempPaths,
  writeFakeOriginal,
} from './helpers.mjs';

/** @param {{ calls: { url: string, method: string }[] }} fetchMock */
const submits = (fetchMock) => fetchMock.calls.filter((c) => c.method === 'POST' && !c.url.includes('/estimate/'));
/** @param {{ calls: { url: string, method: string }[] }} fetchMock */
const estimates = (fetchMock) => fetchMock.calls.filter((c) => c.method === 'POST' && c.url.includes('/estimate/'));

/**
 * A scriptable Higgsfield: estimate / submit / status / download.
 *
 * @param {object} [options]
 * @param {() => unknown} [options.estimate]
 * @param {(count: number) => unknown} [options.submit]
 * @param {(count: number) => unknown} [options.status]
 * @param {() => unknown} [options.download]
 */
function apiHandler(options = {}) {
  const estimate = options.estimate ?? (() => jsonResponse({ usd: '0.035', credits: '1.000' }));
  const submit = options.submit ?? ((count) => jsonResponse({ status: 'queued', request_id: `req-${count}` }));
  const status =
    options.status ?? (() => jsonResponse({ status: 'completed', images: [{ url: 'https://cdn.example/out.png' }] }));
  const download = options.download ?? (() => bytesResponse(PNG_BYTES));

  let submitCount = 0;
  let statusCount = 0;
  return (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    if (url.includes('/estimate/')) return estimate();
    if (url.includes('/requests/')) return status(statusCount++);
    if (init.method === 'POST') return submit(submitCount++);
    return download();
  };
}

/** @type {import('../../scripts/lib/config.mjs').Paths} */
let paths;
beforeEach(() => {
  paths = createTempPaths();
});
afterEach(() => {
  removeTempPaths(paths);
});

/**
 * @param {ReturnType<typeof recordFetch>} fetchMock
 * @param {Partial<Parameters<typeof runGenerate>[1]>} [options]
 */
function generate(fetchMock, options = {}) {
  const { ctx, logs } = createCtx({ fetch: fetchMock, paths });
  return {
    logs,
    run: () =>
      runGenerate(ctx, {
        assets: selectAssets(['ship-carrier', 'ship-battleship']),
        modelPath: DEFAULT_MODEL,
        yes: true,
        intervalMs: 3_000,
        timeoutMs: 300_000,
        ...options,
      }),
  };
}

describe('existing assets are never regenerated (P1)', () => {
  it('skips every asset that already has an original and makes no request at all', async () => {
    for (const asset of ASSETS) writeFakeOriginal(paths, asset.name);
    const fetchMock = recordFetch(apiHandler());
    const { ctx } = createCtx({ fetch: fetchMock, paths });

    const result = await runGenerate(ctx, { assets: ASSETS, modelPath: DEFAULT_MODEL, yes: true });

    expect(result.generated).toEqual([]);
    expect(result.skipped).toHaveLength(ASSETS.length);
    expect(fetchMock.calls).toHaveLength(0);
  });

  it('matches an existing original whatever extension it was downloaded with', () => {
    writeFakeOriginal(paths, 'table', '.jpg');
    writeFakeOriginal(paths, 'title', '.webp');
    expect(findOriginal(paths, 'table')).toMatch(/table\.jpg$/);
    expect(findOriginal(paths, 'title')).toMatch(/title\.webp$/);
    expect(findOriginal(paths, 'victory')).toBeNull();
  });
});

describe('cost guards before the first paid call (P5)', () => {
  it('aborts when the summed estimate exceeds --max-usd, with zero paid calls', async () => {
    const fetchMock = recordFetch(apiHandler({ estimate: () => jsonResponse({ usd: '2.500' }) }));
    const { run } = generate(fetchMock, { maxUsd: 3 });

    await expect(run()).rejects.toThrow(/exceeds the --max-usd cap/);
    expect(estimates(fetchMock)).toHaveLength(2);
    expect(submits(fetchMock)).toHaveLength(0);
  });

  it('aborts when an estimate fails, without submitting anything', async () => {
    const fetchMock = recordFetch(apiHandler({ estimate: () => jsonResponse({ error: 'nope' }, { status: 500 }) }));
    const { run } = generate(fetchMock);

    await expect(run()).rejects.toThrow(/Estimate for .* failed with HTTP 500/);
    expect(submits(fetchMock)).toHaveLength(0);
  });

  it('prints the bill and spends nothing without --yes', async () => {
    const fetchMock = recordFetch(apiHandler());
    const { run, logs } = generate(fetchMock, { yes: false });

    const result = await run();

    expect(result.dryRun).toBe(true);
    expect(result.totalUsd).toBeCloseTo(0.07, 5);
    expect(logs.join('\n')).toMatch(/About to pay for 2 asset\(s\)/);
    expect(logs.join('\n')).toMatch(/ship-carrier/);
    expect(logs.join('\n')).toMatch(/--yes was not passed/);
    expect(submits(fetchMock)).toHaveLength(0);
    expect(fs.existsSync(paths.manifest)).toBe(false);
  });

  it('--redo retires the old original only after the estimate, the cap and --yes', async () => {
    const original = writeFakeOriginal(paths, 'ship-carrier');
    const fetchMock = recordFetch(apiHandler());
    const { ctx } = createCtx({ fetch: fetchMock, paths });

    const result = await runGenerate(ctx, {
      assets: selectAssets(['ship-carrier']),
      modelPath: DEFAULT_MODEL,
      redo: true,
      yes: true,
    });

    expect(result.generated.map((g) => g.name)).toEqual(['ship-carrier']);
    expect(fetchMock.calls[0]?.url).toContain('/estimate/'); // priced before anything moved
    expect(submits(fetchMock)).toHaveLength(1);

    const replaced = fs.readdirSync(paths.replacedDir);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatch(/^ship-carrier\..*\.png$/);
    expect(fs.existsSync(original)).toBe(true); // a fresh original took its place
    expect(fs.readFileSync(original).equals(PNG_BYTES)).toBe(true);
  });

  it('--redo keeps the old original when the estimate fails', async () => {
    const original = writeFakeOriginal(paths, 'ship-carrier');
    const fetchMock = recordFetch(apiHandler({ estimate: () => jsonResponse({}, { status: 500 }) }));
    const { ctx } = createCtx({ fetch: fetchMock, paths });

    await expect(
      runGenerate(ctx, { assets: selectAssets(['ship-carrier']), modelPath: DEFAULT_MODEL, redo: true, yes: true }),
    ).rejects.toThrow(/Aborting/);

    expect(fs.existsSync(original)).toBe(true);
    expect(fs.existsSync(paths.replacedDir)).toBe(false);
    expect(submits(fetchMock)).toHaveLength(0);
  });

  it('leaves a previous original in place when --redo stops at the dry run', async () => {
    const original = writeFakeOriginal(paths, 'ship-carrier');
    const fetchMock = recordFetch(apiHandler());
    const { ctx } = createCtx({ fetch: fetchMock, paths });

    const result = await runGenerate(ctx, {
      assets: selectAssets(['ship-carrier']),
      modelPath: DEFAULT_MODEL,
      redo: true,
      yes: false,
    });

    expect(result.dryRun).toBe(true);
    expect(fs.existsSync(original)).toBe(true);
    expect(fs.existsSync(paths.replacedDir)).toBe(false);
    expect(submits(fetchMock)).toHaveLength(0);
  });
});

describe('submitting and polling (P5)', () => {
  it.each([429, 500, 503])('never retries a submit that returns %i', async (status) => {
    const fetchMock = recordFetch(apiHandler({ submit: () => jsonResponse({ error: 'busy' }, { status }) }));
    const { run } = generate(fetchMock);

    await expect(run()).rejects.toThrow(/not retried on purpose/);
    expect(submits(fetchMock)).toHaveLength(1);
  });

  it('times out, names the request_id and does not resubmit', async () => {
    const fetchMock = recordFetch(apiHandler({ status: () => jsonResponse({ status: 'queued' }) }));
    const { run, logs } = generate(fetchMock, { timeoutMs: 9_000 });

    await expect(run()).rejects.toThrow(/request_id=req-0/);
    expect(submits(fetchMock)).toHaveLength(1); // polled to the timeout, never resubmitted
    expect(logs.join('\n')).toMatch(/request_id=req-0/);
    await expect(run()).rejects.toThrow(/NOT resubmitted/);
  });

  it.each(['failed', 'nsfw'])('stops when the job ends as %s', async (state) => {
    const fetchMock = recordFetch(apiHandler({ status: () => jsonResponse({ status: state }) }));
    const { run } = generate(fetchMock);

    await expect(run()).rejects.toThrow(new RegExp(`ended as "${state}"`));
    expect(submits(fetchMock)).toHaveLength(1);
    expect(fs.readdirSync(paths.originalDir).filter((f) => f.startsWith('ship-'))).toEqual([]);
  });

  it('retries the free status GET on a 5xx and on a transport error', async () => {
    let statusCall = 0;
    const fetchMock = recordFetch(
      apiHandler({
        status: () => {
          statusCall += 1;
          if (statusCall === 1) return jsonResponse({}, { status: 503 });
          if (statusCall === 2) throw new Error('socket hang up');
          return jsonResponse({ status: 'completed', images: [{ url: 'https://cdn.example/out.png' }] });
        },
      }),
    );
    const { run } = generate(fetchMock, { assets: selectAssets(['ship-carrier']) });

    const result = await run();

    expect(result.generated).toHaveLength(1);
    expect(submits(fetchMock)).toHaveLength(1);
    expect(statusCall).toBe(3);
  });
});

describe('results are never lost (P5)', () => {
  it('writes the manifest after every asset, so a mid-run failure keeps what was paid for', async () => {
    const fetchMock = recordFetch(
      apiHandler({ submit: (count) => (count === 0 ? jsonResponse({ request_id: 'req-0' }) : jsonResponse({}, { status: 500 })) }),
    );
    const { run } = generate(fetchMock);

    await expect(run()).rejects.toThrow(/Submit to/);

    const manifest = JSON.parse(fs.readFileSync(paths.manifest, 'utf8'));
    expect(Object.keys(manifest.assets)).toEqual(['ship-carrier']);
    expect(manifest.assets['ship-carrier']).toMatchObject({
      name: 'ship-carrier',
      model: DEFAULT_MODEL,
      request_id: 'req-0',
      usd_estimate: 0.035,
      original: 'assets/original/ship-carrier.png',
      bytes: PNG_BYTES.length,
    });
    expect(manifest.assets['ship-carrier'].body.prompt).toMatch(/aircraft carrier/);
  });

  it('saves the downloaded bytes verbatim under the extension the bytes say', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake-jpeg')]);
    const fetchMock = recordFetch(apiHandler({ download: () => bytesResponse(jpeg, 'application/octet-stream') }));
    const { run } = generate(fetchMock, { assets: selectAssets(['table']) });

    await run();

    const saved = findOriginal(paths, 'table');
    expect(saved).toMatch(/table\.jpg$/);
    expect(fs.readFileSync(/** @type {string} */ (saved)).equals(jpeg)).toBe(true);
  });

  it('runs the local processing step after each paid asset', async () => {
    const fetchMock = recordFetch(apiHandler());
    const { ctx } = createCtx({ fetch: fetchMock, paths });
    /** @type {string[]} */
    const processed = [];

    await runGenerate(
      {
        ...ctx,
        processAsset: async (asset) => {
          processed.push(asset.name);
          return { path: `${paths.optimizedDir}/${asset.optimized}`, bytes: 10 };
        },
      },
      { assets: selectAssets(['ship-carrier']), modelPath: DEFAULT_MODEL, yes: true },
    );

    expect(processed).toEqual(['ship-carrier']);
    const manifest = JSON.parse(fs.readFileSync(paths.manifest, 'utf8'));
    expect(manifest.assets['ship-carrier'].optimized).toBe('src/assets/ships/carrier.webp');
  });
});

describe('credentials never leak (P3)', () => {
  it('keeps the secret out of logs, thrown errors and the manifest', async () => {
    // The nastiest realistic leak: the API echoes the Authorization header back
    // in an error body, and the transport error message quotes it too.
    const leak = `Key ${FAKE_CREDENTIAL}`;
    const fetchMock = recordFetch((url) => {
      if (url.includes('/estimate/')) return jsonResponse({}, { status: 401, text: `{"error":"bad auth for ${leak}"}` });
      throw new Error(`connect ECONNREFUSED while sending ${leak}`);
    });
    const { ctx, logs } = createCtx({ fetch: fetchMock, paths });

    let thrown = null;
    try {
      await runGenerate(ctx, { assets: selectAssets(['ship-carrier']), modelPath: DEFAULT_MODEL, yes: true });
    } catch (err) {
      thrown = redactError(err, ctx.redact);
    }

    const captured = [logs.join('\n'), thrown?.message ?? '', thrown?.stack ?? ''].join('\n');
    expect(thrown).not.toBeNull();
    expect(captured).toMatch(/HTTP 401/);
    expect(captured).not.toContain(FAKE_SECRET);
    expect(captured).not.toContain(FAKE_CREDENTIAL);
    expect(captured).toContain('***');
  });

  it('keeps the secret out of a transport error that quotes the Authorization header', async () => {
    const fetchMock = recordFetch(() => {
      throw new Error(`connect ECONNREFUSED; request had header "Key ${FAKE_CREDENTIAL}"`);
    });
    const { ctx, logs } = createCtx({ fetch: fetchMock, paths });

    let thrown = null;
    try {
      await runGenerate(ctx, { assets: selectAssets(['ship-carrier']), modelPath: DEFAULT_MODEL, yes: true });
    } catch (err) {
      thrown = redactError(err, ctx.redact);
    }

    const captured = [logs.join('\n'), thrown?.message ?? '', thrown?.stack ?? ''].join('\n');
    expect(captured).toMatch(/network error/);
    expect(captured).not.toContain(FAKE_SECRET);
    expect(captured).not.toContain(FAKE_KEY_ID);
  });

  it('redacts before truncating, so a credential on the 200-char boundary cannot survive', async () => {
    // The padding is sized so the credential starts around index 170 of the
    // body and therefore straddles the 200-character excerpt boundary.
    const body = `{"error":"${'x'.repeat(155)} Key ${FAKE_CREDENTIAL}"}`;
    expect(body.indexOf(FAKE_CREDENTIAL)).toBeLessThan(200);
    expect(body.indexOf(FAKE_CREDENTIAL) + FAKE_CREDENTIAL.length).toBeGreaterThan(200);

    const fetchMock = recordFetch(() => jsonResponse({}, { status: 401, text: body }));
    const { ctx, logs } = createCtx({ fetch: fetchMock, paths });

    let thrown = null;
    try {
      await runGenerate(ctx, { assets: selectAssets(['ship-carrier']), modelPath: DEFAULT_MODEL, yes: true });
    } catch (err) {
      thrown = redactError(err, ctx.redact);
    }

    const captured = [logs.join('\n'), thrown?.message ?? '', thrown?.stack ?? ''].join('\n');
    expect(captured).toMatch(/HTTP 401/);
    for (let start = 0; start + 8 <= FAKE_SECRET.length; start++) {
      expect(captured, `leaked slice at ${start}`).not.toContain(FAKE_SECRET.slice(start, start + 8));
    }
    expect(captured).not.toContain(FAKE_KEY_ID.slice(0, 8));
  });

  it('keeps the secret out of a completed run: no credential reaches disk', async () => {
    const fetchMock = recordFetch(apiHandler());
    const { run, logs } = generate(fetchMock, { assets: selectAssets(['ship-carrier']) });

    await run();

    const manifest = fs.readFileSync(paths.manifest, 'utf8');
    expect(manifest).not.toContain(FAKE_SECRET);
    expect(manifest).not.toContain(FAKE_CREDENTIAL);
    expect(logs.join('\n')).not.toContain(FAKE_SECRET);
  });
});

describe('--estimate is free and honest', () => {
  it('prices only the missing assets and says which ones are skipped', async () => {
    writeFakeOriginal(paths, 'ship-carrier');
    const fetchMock = recordFetch(apiHandler());
    const { ctx, logs } = createCtx({ fetch: fetchMock, paths });

    const result = await runEstimate(ctx, {
      assets: selectAssets(['ship-carrier', 'ship-battleship', 'table']),
      modelPath: DEFAULT_MODEL,
    });

    expect(result.skipped).toEqual(['ship-carrier']);
    expect(result.rows.map((row) => row.name)).toEqual(['ship-battleship', 'table']);
    expect(result.total).toBeCloseTo(0.07, 5);
    expect(estimates(fetchMock)).toHaveLength(2);
    expect(submits(fetchMock)).toHaveLength(0);
    expect(logs.join('\n')).toMatch(/no money was spent/);
  });
});
