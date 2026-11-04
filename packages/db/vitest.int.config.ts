import { defineConfig } from 'vitest/config';

// Integration tests start a real Postgres in Docker (Testcontainers).
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
