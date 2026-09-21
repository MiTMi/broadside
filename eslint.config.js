import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // The asset pipeline is plain ESM JavaScript with JSDoc (it runs under bare
    // node, outside the bundler and outside strict TS). Declare the Node/web
    // globals it uses rather than pulling in another dependency.
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        AbortController: 'readonly',
        Buffer: 'readonly',
        Response: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        URL: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        globalThis: 'readonly',
        performance: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        structuredClone: 'readonly',
      },
    },
  },
  {
    // The engine is pure, deterministic and DOM-free (PLAN decisions 4 and 7):
    // these rules make that mechanically enforced rather than merely intended.
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'The engine must stay DOM-free.' },
        { name: 'window', message: 'The engine must stay DOM-free.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded Rng instead.' },
      ],
      'no-restricted-imports': [
        'error',
        { patterns: ['**/ui/**', '**/ui'], },
      ],
    },
  },
  {
    // The net and match layers are pure and DOM-free too (PLAN decisions N2/N6):
    // a match is a state machine over a transport, and the transports move JSON.
    // `BroadcastChannel`, `crypto` and PeerJS are re-allowed just below, in the
    // four files whose whole job is to talk to the outside world.
    files: ['src/net/**/*.ts', 'src/match/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'The net and match layers must stay DOM-free.' },
        { name: 'window', message: 'The net and match layers must stay DOM-free.' },
        { name: 'navigator', message: 'The net and match layers must stay DOM-free.' },
        { name: 'localStorage', message: 'The net and match layers must stay DOM-free.' },
        { name: 'BroadcastChannel', message: 'Only src/net/localTransport.ts may open a channel.' },
        { name: 'crypto', message: 'Only src/net/roomCode.ts and src/net/commitment.ts may use crypto.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Inject randomness so a match is reproducible.' },
      ],
      'no-restricted-imports': [
        'error',
        { patterns: ['**/ui/**', '**/ui'], },
      ],
    },
  },
  {
    // The outside-world files: still no DOM, but they may reach their one global.
    files: [
      'src/net/localTransport.ts',
      'src/net/peerTransport.ts',
      'src/net/roomCode.ts',
      'src/net/commitment.ts',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'The net layer must stay DOM-free.' },
        { name: 'window', message: 'The net layer must stay DOM-free.' },
      ],
      'no-restricted-properties': 'off',
    },
  },
);
