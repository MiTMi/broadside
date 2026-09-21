import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: 'es2022', assetsInlineLimit: 100_000_000, cssCodeSplit: false },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.mjs'],
    environment: 'node',
  },
});
