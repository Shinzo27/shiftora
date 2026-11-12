import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real stack: Vite on 5173, the API on 4000, Postgres on 5433.
 *
 * These cover what unit and integration tests cannot: the browser's own behaviour (focus, drag,
 * dialogs) and the wiring between the two apps. They seed their own organisation through the
 * API, so they never depend on the demo data and can run against a fresh database.
 *
 * Integration tests in `apps/api` already cover the rules; keep these short and user-shaped.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // one org per test, seeded through the same API
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    cwd: '../..',
    timeout: 120_000,
  },
});
