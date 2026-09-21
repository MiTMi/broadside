/**
 * One-time generation of the victory video with Higgsfield (Seedance 2.5).
 *
 * Same money rules as `generate-assets.mjs`: generated ONCE and saved in the
 * repo; refuses to run if the original already exists; needs `--yes`; the single
 * paid submit is never retried; the completed status JSON is written to disk
 * before anything else so a paid result can always be recovered by hand.
 * The game never calls Higgsfield.
 *
 *   node --env-file=.env scripts/generate-video.mjs          # dry run: prints the plan, spends nothing
 *   node --env-file=.env scripts/generate-video.mjs --yes    # pays for ONE video
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveCredentials } from './lib/credentials.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGINAL_DIR = path.join(ROOT, 'assets', 'original');
const NAME = 'victory-video';
const MODEL = 'bytedance/seedance-2.5/text-to-video';
const BASE = 'https://api.higgsfield.ai';

/** List price (before the account discount) used as the worst-case figure: $0.2057 / s at 480p. */
const LIST_USD_PER_SECOND_480P = 0.2057;

const BODY = {
  prompt:
    'Cinematic, photorealistic naval battle at sea, overcast dramatic sky, shot on a long lens from a nearby ship. ' +
    'A large grey enemy warship steams across choppy dark-blue water. A heavy artillery shell streaks in and strikes the ship amidships: ' +
    'a bright flash, then a massive realistic explosion with a fireball, thick black smoke and debris, and water columns erupting alongside. ' +
    "The ship's hull breaks, it lists heavily and begins to sink by the stern, burning, as smoke rolls across the waves. " +
    'Slow push-in camera, realistic physics, film grain, natural colours, highly detailed. No text, no logos, no people visible.',
  duration: 10,
  resolution: '480p',
  aspect_ratio: '16:9',
  generate_audio: true,
};

/** Every string value in a JSON tree that looks like a video URL. */
function findVideoUrls(node, out = []) {
  if (typeof node === 'string') {
    if (/^https?:\/\/\S+\.(mp4|webm|mov)(\?\S*)?$/i.test(node)) out.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) findVideoUrls(item, out);
  } else if (node && typeof node === 'object') {
    // Prefer an explicit `video` field when the API has one.
    if (node.video) findVideoUrls(node.video, out);
    for (const [key, value] of Object.entries(node)) if (key !== 'video') findVideoUrls(value, out);
  }
  return out;
}

async function main() {
  const yes = process.argv.includes('--yes');
  const existing = fs.existsSync(ORIGINAL_DIR)
    ? fs.readdirSync(ORIGINAL_DIR).find((file) => file.startsWith(`${NAME}.`) && !file.endsWith('.json'))
    : undefined;
  if (existing) {
    console.log(`Already generated: assets/original/${existing}. Nothing to do — this script never regenerates it.`);
    return;
  }

  const worstCase = BODY.duration * LIST_USD_PER_SECOND_480P;
  console.log(`About to pay for ONE video with ${MODEL}:`);
  console.log(`  ${BODY.duration} s, ${BODY.resolution}, ${BODY.aspect_ratio}, audio ${BODY.generate_audio ? 'on' : 'off'}`);
  console.log(`  worst case (list price) $${worstCase.toFixed(2)}; with the account discount about $${(worstCase * 0.7).toFixed(2)}`);
  if (!yes) {
    console.log('Dry run: --yes was not passed, so nothing was submitted and nothing was charged.');
    return;
  }

  const credentials = resolveCredentials(process.env);
  const redact = credentials.redact;
  const headers = { Authorization: credentials.authHeader, 'Content-Type': 'application/json', Accept: 'application/json' };

  // The one paid call. Never retried: a retried submit can be charged twice.
  const submit = await fetch(`${BASE}/${MODEL}`, { method: 'POST', headers, body: JSON.stringify(BODY) });
  const submitText = redact(await submit.text());
  if (!submit.ok) {
    console.error(`Submit failed with HTTP ${submit.status}: ${submitText.slice(0, 300)} — not retried, nothing further was sent.`);
    process.exitCode = 1;
    return;
  }
  const job = JSON.parse(submitText);
  const requestId = job.request_id;
  console.log(`  request_id=${requestId}`);
  fs.mkdirSync(ORIGINAL_DIR, { recursive: true });
  fs.writeFileSync(path.join(ORIGINAL_DIR, `${NAME}.request.json`), JSON.stringify({ request_id: requestId, model: MODEL, body: BODY, submitted_at: new Date().toISOString() }, null, 2));

  const deadline = Date.now() + 20 * 60 * 1000;
  let status;
  let last = '';
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      const res = await fetch(`${BASE}/requests/${requestId}/status`, { headers });
      if (!res.ok) continue; // polling is free and safe to repeat
      status = await res.json();
    } catch {
      continue;
    }
    if (status.status !== last) {
      last = status.status;
      console.log(`  status: ${last}`);
    }
    if (['completed', 'failed', 'nsfw', 'canceled', 'cancelled'].includes(status.status)) break;
  }

  if (!status || status.status !== 'completed') {
    console.error(`Job did not complete (last status: ${status?.status ?? 'unknown'}). request_id=${requestId}. Failed/NSFW jobs are refunded by Higgsfield. Not resubmitted.`);
    process.exitCode = 1;
    return;
  }

  // Persist the raw result first: whatever happens next, the paid output is recoverable.
  fs.writeFileSync(path.join(ORIGINAL_DIR, `${NAME}.status.json`), redact(JSON.stringify(status, null, 2)));
  const url = findVideoUrls(status)[0];
  if (!url) {
    console.error(`Completed, but no video URL was recognised. The full result is saved in assets/original/${NAME}.status.json (request_id=${requestId}).`);
    process.exitCode = 1;
    return;
  }

  const download = await fetch(url); // no Authorization header: this is a CDN, not the API
  if (!download.ok) {
    console.error(`Download failed with HTTP ${download.status}. The job is PAID — URL is in assets/original/${NAME}.status.json.`);
    process.exitCode = 1;
    return;
  }
  const bytes = Buffer.from(await download.arrayBuffer());
  const ext = (url.match(/\.(mp4|webm|mov)(\?|$)/i)?.[1] ?? 'mp4').toLowerCase();
  const target = path.join(ORIGINAL_DIR, `${NAME}.${ext}`);
  fs.writeFileSync(target, bytes);
  console.log(`  saved assets/original/${NAME}.${ext} (${bytes.length} bytes)`);
}

main().catch((err) => {
  console.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
