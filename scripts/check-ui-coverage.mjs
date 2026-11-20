#!/usr/bin/env node
// The UI coverage check (W7½ UI3): every API route has a screen that calls it, or a written reason
// in docs/ui-coverage.md for why it has none. A new endpoint without either fails CI — the owner's
// rule that a feature is not done until it has a screen (AGENTS.md → How to work a day, step 5).
//
// It reads source text, not a running app: routes from `@Controller(...)` + `@Get/@Post/...(...)` in
// apps/api/src, calls from the path strings in the web app's API client, and the allowlist from the
// "API-only routes and why" table. Pure functions are exported for the unit test.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every `.ts` file under `dir`, tests excluded. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules' && entry !== '__tests__') out.push(...sourceFiles(path));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(path);
    }
  }
  return out;
}

/** `/employees/:id/time-off` and `/employees/${id}/time-off` both become `/employees/:/time-off`. */
export function normalise(path) {
  return (
    '/' +
    path
      .split('?')[0]
      .split('/')
      .filter(Boolean)
      .map((part) => (part.startsWith(':') || part.includes('${') ? ':' : part))
      .join('/')
  );
}

/** `[{ method, path }]` declared by one controller file's source. */
export function routesIn(source) {
  const prefix = /@Controller\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/.exec(source);
  if (!prefix) return [];
  const base = prefix[1] ?? prefix[2] ?? '';
  const routes = [];
  for (const match of source.matchAll(
    /@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/g,
  )) {
    const sub = match[2] ?? match[3] ?? '';
    const path = [base, sub].filter(Boolean).join('/');
    routes.push({ method: match[1].toUpperCase(), path: normalise(path) });
  }
  return routes;
}

/** Normalised paths the web app's API client calls (method-agnostic: a path is a screen's call). */
export function callsIn(source) {
  const calls = new Set();
  for (const match of source.matchAll(/[`'"](\/[a-z][^`'"\s]*)/g)) calls.add(normalise(match[1]));
  return calls;
}

/**
 * The allowlist: every backticked route in the first column of the "API-only routes and why"
 * table. `METHOD /path` matches that method only, `/path` any method, and a trailing `*` matches a
 * whole subtree.
 */
export function allowlistIn(markdown) {
  const section = markdown.split(/^## API-only routes and why/m)[1]?.split(/^## /m)[0] ?? '';
  const entries = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('|') || line.startsWith('|---') || line.startsWith('| Route')) continue;
    const first = line.split('|')[1] ?? '';
    for (const [, code] of first.matchAll(/`([^`]+)`/g)) {
      const [maybeMethod, ...rest] = code.trim().split(/\s+/);
      const hasMethod = /^(GET|POST|PUT|PATCH|DELETE)$/.test(maybeMethod);
      const path = hasMethod ? rest.join(' ') : code.trim();
      entries.push({
        methods: hasMethod ? [maybeMethod] : null,
        path: path.endsWith('*') ? path : normalise(path),
        raw: code,
      });
    }
  }
  return entries;
}

export function allowed(route, entries) {
  return entries.find(
    (entry) =>
      (entry.methods === null || entry.methods.includes(route.method)) &&
      (entry.path.endsWith('*')
        ? route.path.startsWith(entry.path.slice(0, -1).replace(/\/$/, ''))
        : entry.path === route.path),
  );
}

/** Routes with neither a caller nor an allowlist entry, and allowlist entries that match nothing. */
export function check({ routes, calls, entries }) {
  const missing = routes.filter((route) => !calls.has(route.path) && !allowed(route, entries));
  const stale = entries.filter((entry) => !routes.some((route) => allowed(route, [entry])));
  return { missing, stale };
}

function main() {
  const routes = sourceFiles(join(ROOT, 'apps/api/src'))
    .filter((file) => file.endsWith('.controller.ts'))
    .flatMap((file) => routesIn(readFileSync(file, 'utf8')));
  const calls = new Set();
  for (const file of ['apps/web/src/lib/api.ts', 'apps/web/src/lib/api-client.ts']) {
    for (const call of callsIn(readFileSync(join(ROOT, file), 'utf8'))) calls.add(call);
  }
  const entries = allowlistIn(readFileSync(join(ROOT, 'docs/ui-coverage.md'), 'utf8'));
  const { missing, stale } = check({ routes, calls, entries });

  for (const entry of stale) {
    console.warn(`ui-coverage: allowlist entry \`${entry.raw}\` matches no API route any more`);
  }
  if (missing.length > 0) {
    console.error(
      'ui-coverage: these API routes have no screen and no reason in docs/ui-coverage.md:',
    );
    for (const route of missing) console.error(`  ${route.method} ${route.path}`);
    console.error(
      'Build the screen, or add the route to "API-only routes and why" with the reason.',
    );
    process.exit(1);
  }
  console.log(`ui-coverage: ${routes.length} routes, all covered by a screen or a written reason.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
