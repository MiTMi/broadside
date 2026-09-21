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
);
