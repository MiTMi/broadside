/**
 * The CLI surface, exercised by really spawning the script.
 *
 * Every spawn here runs WITHOUT --env-file and with the credential variables
 * explicitly blanked, so the script stops at the credentials check and cannot
 * reach the network even if a real key exists on the machine.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MISSING_CREDENTIALS_MESSAGE, resolveCredentials } from '../../scripts/lib/credentials.mjs';
import { parseArgs } from '../../scripts/generate-assets.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/generate-assets.mjs');

/** @param {string[]} args */
function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, HF_CREDENTIALS: '', HF_API_KEY: '', HF_API_SECRET: '' },
  });
}

describe('missing credentials', () => {
  it('names the variables, exits 1 and prints no stack trace', () => {
    const result = runCli(['--estimate']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('HF_CREDENTIALS');
    expect(result.stderr).toContain('HF_API_KEY');
    expect(result.stderr).toContain('HF_API_SECRET');
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(result.stderr).not.toMatch(/\n\s*at /);
    expect(result.stderr).not.toContain('Error:');
  });

  it.each([['--probe'], ['--generate'], ['--redo', 'ship-carrier', '--yes']])(
    'stops before any request for %s',
    (...args) => {
      const result = runCli(args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(MISSING_CREDENTIALS_MESSAGE);
    },
  );
});

describe('resolveCredentials', () => {
  it('prefers HF_CREDENTIALS', () => {
    expect(resolveCredentials({ HF_CREDENTIALS: 'a-key:a-secret', HF_API_KEY: 'other:thing' }).authHeader).toBe(
      'Key a-key:a-secret',
    );
  });

  it('accepts a single HF_API_KEY that already holds "<id>:<secret>" (D5)', () => {
    expect(resolveCredentials({ HF_API_KEY: 'a-key:a-secret' }).authHeader).toBe('Key a-key:a-secret');
  });

  it('joins HF_API_KEY and HF_API_SECRET when they are separate', () => {
    expect(resolveCredentials({ HF_API_KEY: 'a-key', HF_API_SECRET: 'a-secret' }).authHeader).toBe('Key a-key:a-secret');
  });

  it('treats blank values as missing', () => {
    expect(() => resolveCredentials({ HF_API_KEY: '  ', HF_API_SECRET: '' })).toThrow(/Missing Higgsfield credentials/);
    expect(() => resolveCredentials({})).toThrow(/HF_API_SECRET/);
  });

  it('redacts every part of the credential', () => {
    const { redact } = resolveCredentials({ HF_API_KEY: 'key-id-1234:secret-value-5678' });
    const leak = redact('Authorization: Key key-id-1234:secret-value-5678 failed');
    expect(leak).not.toContain('secret-value-5678');
    expect(leak).not.toContain('key-id-1234');
    expect(leak).toContain('***');
  });
});

describe('argument parsing', () => {
  it('reads the mode, names and options', () => {
    const options = parseArgs(['--redo', 'ship-carrier', '--yes', '--max-usd', '0.5', '--model', 'a/b']);
    expect(options).toMatchObject({ mode: 'redo', names: ['ship-carrier'], yes: true, maxUsd: 0.5, model: 'a/b' });
  });

  it('defaults to no spend', () => {
    expect(parseArgs(['--generate']).yes).toBe(false);
  });

  it('refuses two modes at once and unknown flags', () => {
    expect(() => parseArgs(['--generate', '--process'])).toThrow(/Pick one mode/);
    expect(() => parseArgs(['--generat'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['--max-usd'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--max-usd', 'lots'])).toThrow(/needs a number/);
  });

  it('exits 1 with usage when no mode is given', () => {
    const result = runCli([]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Broadside asset pipeline');
    expect(result.stderr).toContain('No mode given');
  });

  it('prints help and exits 0', () => {
    const result = runCli(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--placeholders');
    expect(result.stdout).toContain('requires --yes');
  });
});
