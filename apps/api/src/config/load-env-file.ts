import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Repo-root .env, from both src/config and dist/config.
const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));

/**
 * Local development convenience: loads the repo-root .env if it exists.
 * Variables already set in the environment win. Production sets real env vars.
 */
export function loadEnvFile(): void {
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}
