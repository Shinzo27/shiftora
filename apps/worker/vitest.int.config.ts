import { defineConfig } from 'vitest/config';

// Integration tests: real Postgres via Testcontainers (needs Docker). The relay's whole job is
// SQL semantics — SKIP LOCKED, RLS, transaction rollback — so a fake database would test nothing.
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
