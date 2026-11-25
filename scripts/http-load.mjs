#!/usr/bin/env node
/**
 * HTTP capacity run for Shiftora using autocannon.
 *
 * Autocannon answers "how many requests per second at what latency" — a different
 * question from scripts/claim-race.mjs, which answers "can two people hold the same
 * shift". Neither substitutes for the other: autocannon fires identical requests from
 * one identity and asserts nothing about the data afterwards.
 *
 *   node scripts/http-load.mjs --connections 50 --duration 10
 *
 * Spawns the API itself, so nothing needs to be running first.
 */
import { spawn } from 'node:child_process';
import autocannon from 'autocannon';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4000/api/v1';
const PASSWORD = 'demo-clinic-2026';
const WEEK_START = '2026-11-23';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : dflt;
};
const CONNECTIONS = arg('connections', 50);
const DURATION = arg('duration', 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const call = (token, orgId, path, init = {}) => {
  const headers = { ...(init.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (orgId) headers['x-org-id'] = orgId;
  return fetch(`${BASE}${path}`, { ...init, headers });
};

async function waitForHealth(timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health/live`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {}
    await sleep(400);
  }
  return false;
}

async function login(email) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login ${email} -> ${r.status}`);
  return (await r.json()).accessToken;
}

function run(opts) {
  return new Promise((resolve, reject) => {
    autocannon(opts, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

const summarise = (label, r, path) => ({
  label,
  path,
  requestsPerSec: Math.round(r.requests.average),
  totalRequests: r.requests.total,
  non2xx: r.non2xx,
  p50: r.latency.p50,
  p95: r.latency.p97_5,
  p99: r.latency.p99,
  max: r.latency.max,
  throughputMB: Math.round(r.throughput.average / 1024 / 1024),
});

async function main() {
  const cwd = new URL('../apps/api/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const child = spawn('node', ['--env-file-if-exists=../../.env', 'dist/main.js'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d.toString()));
  child.stderr.on('data', (d) => (log += d.toString()));

  const out = {
    ranAt: new Date().toISOString(),
    machine: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpus: (await import('node:os')).cpus().length,
      memGB: Math.round((await import('node:os')).totalmem() / 1024 ** 3),
    },
    config: { connections: CONNECTIONS, durationSeconds: DURATION },
    results: [],
  };

  try {
    if (!(await waitForHealth())) {
      console.error('API never became healthy\n', log.slice(-1500));
      process.exit(1);
    }

    const owner = await login('priya@sunriseclinic.test');
    const staff = await login('asha@sunriseclinic.test');
    const orgs = await (await call(owner, null, '/orgs')).json();
    const orgId = (Array.isArray(orgs) ? orgs : orgs.orgs)[0].id;
    const locations = await (await call(owner, orgId, '/locations')).json();
    const locationId = (Array.isArray(locations) ? locations : locations.items)[0].id;

    const targets = [
      {
        label: 'health (unauth, baseline)',
        path: '/health/live',
        headers: {},
      },
      {
        label: 'me/open-shifts (staff, auth + RLS)',
        path: '/me/open-shifts',
        headers: { authorization: `Bearer ${staff}`, 'x-org-id': orgId },
      },
      {
        label: 'schedules (owner, auth + query)',
        path: `/schedules?locationId=${locationId}&weekStart=${WEEK_START}`,
        headers: { authorization: `Bearer ${owner}`, 'x-org-id': orgId },
      },
    ];

    for (const t of targets) {
      const r = await run({
        url: `${BASE}${t.path}`,
        connections: CONNECTIONS,
        duration: DURATION,
        headers: t.headers,
        // No pipelining: this models concurrent clients, not one client batching.
      });
      out.results.push(summarise(t.label, r, t.path));
      console.error(`done: ${t.label}`);
    }
  } finally {
    child.kill('SIGTERM');
    await sleep(400);
    child.kill('SIGKILL');
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
