import { runMigrations } from '../migrate.js';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error('MIGRATION_DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}

await runMigrations(url);
console.log('Migrations applied.');
