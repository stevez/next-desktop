import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.mjs'],
      // The thin shell that only wires the pure parts to the file system, child processes,
      // esbuild, electron-builder and Electron. Checked by real builds and launches instead
      // (docs/architecture.md, section 10).
      exclude: ['src/**/__tests__/**', 'src/cli.mjs', 'src/build.mjs', 'src/runtime/main.mjs'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { 100: true },
    },
  },
});
