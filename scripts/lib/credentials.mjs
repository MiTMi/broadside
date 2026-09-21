/**
 * Higgsfield credentials (PLAN P3, superseded in part by DECISIONS D5).
 *
 * Read ONLY from `process.env`, which the npm scripts populate with Node's
 * native `--env-file=.env`. Nothing in this repo ever opens `.env` itself and
 * nothing ever prints a credential.
 *
 * The account's credential is a single `"KEY_ID:KEY_SECRET"` string (D5), so:
 *   1. `HF_CREDENTIALS` wins if set;
 *   2. else `HF_API_KEY` is used as-is when it already contains `:`;
 *   3. else `HF_API_KEY` and `HF_API_SECRET` are joined with `:`.
 */

import { CliError, createRedactor } from './errors.mjs';

export const MISSING_CREDENTIALS_MESSAGE =
  'Missing Higgsfield credentials: set HF_CREDENTIALS="<key-id>:<key-secret>" in .env — or HF_API_KEY holding the whole "<key-id>:<key-secret>" string, or HF_API_KEY plus HF_API_SECRET (the npm script loads .env with node --env-file=.env).';

/** @typedef {{ credential: string, authHeader: string, redact: import('./errors.mjs').Redactor }} Credentials */

/**
 * @param {Record<string, string | undefined>} env
 * @returns {Credentials}
 * @throws {CliError} when no usable credential is present.
 */
export function resolveCredentials(env) {
  const combined = (env['HF_CREDENTIALS'] ?? '').trim();
  if (combined) return build(requirePair(combined, 'HF_CREDENTIALS'));

  const key = (env['HF_API_KEY'] ?? '').trim();
  const secret = (env['HF_API_SECRET'] ?? '').trim();

  if (key && key.includes(':')) return build(requirePair(key, 'HF_API_KEY'));
  if (key && secret) return build(`${key}:${secret}`);

  throw new CliError(MISSING_CREDENTIALS_MESSAGE);
}

/**
 * @param {string} value
 * @param {string} variable
 * @returns {string}
 */
function requirePair(value, variable) {
  const separator = value.indexOf(':');
  if (separator > 0 && value.slice(separator + 1).trim()) return value;
  throw new CliError(`${variable} must look like "<key-id>:<key-secret>". ${MISSING_CREDENTIALS_MESSAGE}`);
}

/**
 * @param {string} credential `"<key-id>:<key-secret>"`
 * @returns {Credentials}
 */
function build(credential) {
  const authHeader = `Key ${credential}`;
  const parts = credential.split(':');
  return { credential, authHeader, redact: createRedactor([authHeader, credential, ...parts]) };
}
