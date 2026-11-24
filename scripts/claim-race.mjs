#!/usr/bin/env node
/**
 * Claim-race harness for Shiftora — correctness under concurrency.
 *
 * A scheduling product is judged on whether two people can end up holding the same
 * shift, so this fires simultaneous claims at one open shift from several eligible
 * staff and asserts exactly one winner per shift.
 *
 * Setup performed on the LOCAL dev database (re-seed to undo):
 *   - the seed gives each staff member a different role and location, so no two
 *     people are eligible for the same shift; the harness grants all three the
 *     Nurse role at Andheri, otherwise the "race" would have one eligible racer
 *     and prove nothing;
 *   - it creates N open shifts (employeeId: null) inside the seeded published week.
 *
 *   node scripts/claim-race-v2.mjs --rounds 6
 *
 * Exit 0 only if every round had exactly one winner.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4000/api/v1';
const PASSWORD = 'demo-clinic-2026';
const OWNER = 'priya@sunriseclinic.test';
const STAFF = [
  ['asha', 'asha@sunriseclinic.test'],
  ['rohan', 'rohan@sunriseclinic.test'],
  ['meera', 'meera@sunriseclinic.test'],
];
const WEEK_START = '2026-11-23';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : dflt;
};
const ROUNDS = arg('rounds', 6);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const call = (token, orgId, path, init = {}) => {
  const headers = { ...(init.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (orgId) headers['x-org-id'] = orgId;
  if (init.body) headers['content-type'] = 'application/json';
  return fetch(`${BASE}${path}`, { ...init, headers });
};

async function waitForHealth(timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health/live`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
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
  if (!r.ok) throw new Error(`login ${email} -> ${r.status} ${await r.text()}`);
  return (await r.json()).accessToken;
}

async function claim(token, orgId, shiftId) {
  const t0 = performance.now();
  const r = await call(token, orgId, `/me/open-shifts/${shiftId}/claim`, {
    method: 'POST',
    headers: { 'idempotency-key': randomUUID() },
  });
  const ms = performance.now() - t0;
  let code = null;
  try {
    code = (await r.json())?.code ?? null;
  } catch {
    /* empty body */
  }
  return { status: r.status, code, ms };
}

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return Number(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(1));
};

const listOf = (j, k) => (Array.isArray(j) ? j : (j?.[k] ?? j?.items ?? []));

async function main() {
  const cwd = new URL('../apps/api/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const child = spawn('node', ['--env-file-if-exists=../../.env', 'dist/main.js'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (d) => (serverLog += d.toString()));
  child.stderr.on('data', (d) => (serverLog += d.toString()));

  const out = { startedAt: new Date().toISOString(), base: BASE, setup: {}, rounds: [], summary: {} };
  try {
    if (!(await waitForHealth())) {
      console.error('API never became healthy.\n', serverLog.slice(-2500));
      process.exit(1);
    }
    out.serverUp = true;

    const owner = await login(OWNER);
    const orgs = await (await call(owner, null, '/orgs')).json();
    const orgId = listOf(orgs, 'orgs')[0].id;

    const locations = listOf(await (await call(owner, orgId, '/locations')).json(), 'locations');
    const roles = listOf(await (await call(owner, orgId, '/job-roles')).json(), 'jobRoles');
    const employees = listOf(await (await call(owner, orgId, '/employees')).json(), 'employees');

    const andheri = locations.find((l) => /andheri/i.test(l.name)) ?? locations[0];
    const nurse = roles.find((r) => /nurse/i.test(r.name)) ?? roles[0];

    for (const emp of employees.slice(0, 3)) {
      await call(owner, orgId, `/employees/${emp.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ jobRoleIds: [nurse.id], locationIds: [andheri.id] }),
      });
    }
    out.setup = {
      orgId,
      location: andheri.name,
      jobRole: nurse.name,
      eligibleStaff: employees.slice(0, 3).map((e) => e.name),
      note: 'all three racers granted the same role and location so the race is real',
    };

    const schedules = listOf(
      await (
        await call(owner, orgId, `/schedules?locationId=${andheri.id}&weekStart=${WEEK_START}`)
      ).json(),
      'schedules',
    );
    if (!schedules.length) throw new Error('no schedule for the seeded week');
    const scheduleId = schedules[0].id;

    const shiftIds = [];
    const SLOTS = [
      ['09:00', '12:00'],
      ['14:00', '18:00'],
    ];
    for (let i = 0; i < ROUNDS; i++) {
      const dayNum = 25 + Math.floor(i / SLOTS.length); // future days of the seeded week
      if (dayNum > 29) break;
      const [startTime, endTime] = SLOTS[i % SLOTS.length];
      const day = String(dayNum).padStart(2, '0');
      const res = await call(owner, orgId, '/shifts', {
        method: 'POST',
        body: JSON.stringify({
          scheduleId,
          employeeId: null,
          jobRoleId: nurse.id,
          date: `2026-11-${day}`,
          startTime,
          endTime,
          breakMinutes: 0,
        }),
      });
      const body = await res.json();
      const id = body?.shift?.id ?? body?.id;
      if (!res.ok || !id) {
        out.setup.shiftCreateError = `${res.status} ${JSON.stringify(body).slice(0, 200)}`;
        break;
      }
      // A shift is not claimable until a manager offers it (offered_at is set).
      const offer = await call(owner, orgId, `/shifts/${id}/offer`, { method: 'POST' });
      if (!offer.ok) {
        out.setup.offerError = `${offer.status} ${(await offer.text()).slice(0, 200)}`;
        break;
      }
      shiftIds.push(id);
    }
    out.setup.shiftsCreated = shiftIds.length;

    const tokens = {};
    for (const [name, email] of STAFF) tokens[name] = await login(email);

    const latencies = [];
    for (const id of shiftIds) {
      const results = await Promise.all(Object.values(tokens).map((t) => claim(t, orgId, id)));
      results.forEach((r) => latencies.push(r.ms));
      out.rounds.push({
        shiftId: id,
        racers: results.length,
        winners: results.filter((r) => r.status === 200).length,
        statuses: results.map((r) => r.status),
        codes: results.map((r) => r.code),
      });
    }

    const winners = out.rounds.map((r) => r.winners);
    const statuses = out.rounds.flatMap((r) => r.statuses);
    out.summary = {
      rounds: out.rounds.length,
      racersPerRound: STAFF.length,
      roundsWithExactlyOneWinner: winners.filter((w) => w === 1).length,
      roundsWithZeroWinners: winners.filter((w) => w === 0).length,
      roundsWithMultipleWinners: winners.filter((w) => w > 1).length,
      totalClaims: statuses.length,
      ok200: statuses.filter((s) => s === 200).length,
      conflict409: statuses.filter((s) => s === 409).length,
      otherStatuses: statuses.filter((s) => s !== 200 && s !== 409),
      serverErrors5xx: statuses.filter((s) => s >= 500).length,
      latencyMs: { p50: pct(latencies, 50), p95: pct(latencies, 95), max: pct(latencies, 100) },
    };
  } finally {
    child.kill('SIGTERM');
    await sleep(400);
    child.kill('SIGKILL');
  }

  console.log(JSON.stringify(out, null, 2));
  process.exit(
    out.summary.roundsWithMultipleWinners > 0 || out.summary.roundsWithZeroWinners > 0 ? 1 : 0,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
