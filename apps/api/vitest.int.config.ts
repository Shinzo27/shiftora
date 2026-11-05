import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests: real Postgres via Testcontainers (needs Docker), full HTTP stack.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.int.test.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
