import { defineConfig } from 'vitest/config';

// Unit tests: pure functions, no Docker.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts'],
  },
});
