import { defineConfig, devices } from '@playwright/test';

/** The API and the web app, as the browser and the seed helper reach them. */
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000/api/v1';
// Vite listens on localhost (IPv6 ::1 here); 127.0.0.1 would refuse. The API binds 0.0.0.0.
const WEB_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

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
  /**
   * **Two servers, waited on separately.** `pnpm dev` starts Vite and NestJS together, but Vite
   * is ready in about a second while the API is still compiling — and `seedClinic()` calls the
   * API before the browser opens. Waiting only on the web app is what made CI fail with
   * `ECONNREFUSED :4000`: the tests began in the window where the page was up and the API was
   * not. Each server is waited on at its own readiness URL instead.
   */
  webServer: [
    {
      // `/health/live` answers as soon as the HTTP server listens — what a client needs.
      command: 'pnpm --filter @shiftora/api dev',
      url: `${API_URL}/health/live`,
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 180_000,
    },
    {
      command: 'pnpm --filter @shiftora/web dev',
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 120_000,
    },
  ],
});
