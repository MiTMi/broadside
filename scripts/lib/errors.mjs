/**
 * Errors and secret redaction for the asset pipeline.
 *
 * Credentials must never reach stdout, stderr, a thrown error or the manifest
 * (PLAN P3), so every string that comes from outside this repo — a response
 * body, a network error message, a header echo — goes through a redactor
 * before it is embedded anywhere.
 */

/**
 * A user-facing error: the CLI prints its message on a single line and exits 1
 * without a stack trace.
 */
export class CliError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'CliError';
  }
}

/** A redactor: replaces every known secret in a string with `***`. */
/** @typedef {(input: unknown) => string} Redactor */

/**
 * Build a redactor for the given secret values.
 *
 * Longest values are replaced first so that `id:secret` cannot survive as a
 * partially-replaced fragment. Values shorter than 4 characters are ignored:
 * they would turn ordinary output into confetti and are not credible keys.
 *
 * @param {readonly (string | undefined | null)[]} secrets
 * @returns {Redactor}
 */
export function createRedactor(secrets) {
  const values = [...new Set(secrets.filter((s) => typeof s === 'string' && s.trim().length >= 4))]
    .map((s) => /** @type {string} */ (s))
    .sort((a, b) => b.length - a.length);

  return (input) => {
    let text = typeof input === 'string' ? input : String(input);
    for (const value of values) text = text.split(value).join('***');
    return text;
  };
}

/** A redactor for when no credentials have been resolved yet. */
export const noRedact = /** @type {Redactor} */ ((input) =>
  typeof input === 'string' ? input : String(input));

/**
 * Return a copy of `err` whose message and stack have been redacted. The
 * original is dropped entirely (no `cause`) so nothing can leak through a
 * nested error.
 *
 * @param {unknown} err
 * @param {Redactor} redact
 * @returns {Error}
 */
export function redactError(err, redact) {
  const source = err instanceof Error ? err : new Error(String(err));
  const clean = err instanceof CliError ? new CliError(redact(source.message)) : new Error(redact(source.message));
  clean.stack = redact(source.stack ?? clean.stack ?? '');
  return clean;
}
