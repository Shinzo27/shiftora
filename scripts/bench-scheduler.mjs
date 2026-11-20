#!/usr/bin/env node
// Auto-scheduler benchmark (W7 D6): `pnpm --filter @shiftora/domain bench` (builds first).
//
// Runs the real solver (from dist, exactly what the worker runs) on the seeded clinics in
// packages/domain/src/scheduling/auto/benchmark.ts, re-checks every answer against every hard rule, and prints a
// Markdown table for the README. Timings are wall clock on this machine, after one warm-up run.

import { cpus } from 'node:os';

import { expandWeek, solve, solveGreedy } from '../packages/domain/dist/index.js';
import {
  hardRuleBreaches,
  largeClinic,
} from '../packages/domain/dist/scheduling/auto/benchmark.js';

const SCENARIOS = [
  { name: '50 staff × 7 days', employees: 50, demand: 1, seeds: 20 },
  { name: '50 staff × 7 days, tight (1.8× demand)', employees: 50, demand: 1.8, seeds: 20 },
  { name: '100 staff × 7 days', employees: 100, demand: 1, seeds: 10 },
  { name: '200 staff × 7 days', employees: 200, demand: 1, seeds: 5 },
];
const BUDGET_MS = 2_000; // what the worker gives solve()

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const ms = (value) => `${Math.round(value)} ms`;

// Warm-up: the first run pays for JIT compilation, which no real week would.
solve(largeClinic({ seed: 999 }), { budgetMs: BUDGET_MS });

const rows = [];
for (const scenario of SCENARIOS) {
  const greedyMs = [];
  const solveMs = [];
  let slots = 0;
  let filled = 0;
  let improvedBy = 0;
  let breaches = 0;
  let spread = 0;
  for (let seed = 1; seed <= scenario.seeds; seed += 1) {
    const problem = largeClinic({ seed, employees: scenario.employees, demand: scenario.demand });
    let started = performance.now();
    const greedy = solveGreedy(problem);
    greedyMs.push(performance.now() - started);

    started = performance.now();
    const solution = solve(problem, { budgetMs: BUDGET_MS });
    solveMs.push(performance.now() - started);

    slots += expandWeek(problem).length;
    filled += solution.assignments.length;
    improvedBy += solution.assignments.length - greedy.assignments.length;
    breaches += hardRuleBreaches(problem, solution).length;
    spread += solution.score.fairnessSpreadMinutes;
  }
  const runs = scenario.seeds;
  rows.push(
    `| ${scenario.name} | ${slots / runs} | ${ms(percentile(greedyMs, 50))} / ${ms(percentile(greedyMs, 95))} | ` +
      `${ms(percentile(solveMs, 50))} / ${ms(percentile(solveMs, 95))} | ` +
      `${((100 * filled) / slots).toFixed(1)}% | +${(improvedBy / runs).toFixed(1)} | ` +
      `${(spread / runs / 60).toFixed(1)} h | ${breaches} |`,
  );
}

console.log(
  `Node ${process.version}, ${cpus()[0]?.model ?? 'unknown CPU'} (${cpus().length} threads); ` +
    `solve() budget ${BUDGET_MS} ms; seeds 1…n per row.\n`,
);
console.log(
  '| Week | Slots | Greedy p50 / p95 | solve() p50 / p95 | Filled | Backtracking adds | Fairness spread | Hard-rule breaches |',
);
console.log('|---|---|---|---|---|---|---|---|');
for (const row of rows) console.log(row);
