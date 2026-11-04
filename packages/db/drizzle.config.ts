import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` diffs src/schema against migrations/ and writes the next SQL file.
// Review every generated file and add RLS policies and grants to it before committing.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  migrations: { prefix: 'index' },
});
