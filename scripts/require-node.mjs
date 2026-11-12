#!/usr/bin/env node
/**
 * Fails with a sentence instead of a stack trace when the wrong Node is on PATH.
 *
 * The API needs Node 26: `Temporal` is native there, and the Nest CLI's watcher takes an ESM
 * path that Node 22 mishandles — `nest start --watch` dies inside `@angular-devkit` with
 * `ERR_REQUIRE_CYCLE_MODULE: Cannot require() ES Module ora … in a cycle`, which describes the
 * symptom and not the cause. `engines` alone only warns, and only at install time, so this runs
 * before `dev`, `build` and the tests.
 *
 * Run it yourself any time: `node scripts/require-node.mjs`.
 */
const REQUIRED_MAJOR = 26;

const current = process.versions.node;
const major = Number.parseInt(current.split('.')[0] ?? '0', 10);

if (major >= REQUIRED_MAJOR) process.exit(0);

const fixed = [
  `This repo needs Node ${REQUIRED_MAJOR}+ (found ${current} at ${process.execPath}).`,
  '',
  'Why: the API uses native `Temporal`, and Node 22 fails inside the Nest watcher with',
  '`ERR_REQUIRE_CYCLE_MODULE` — a message about ora, not about your Node version.',
  '',
  'Pick one:',
  '  nvm use            # nvm-windows reads .nvmrc, or: nvm use 26',
  '  fnm use            # fnm reads .nvmrc too',
  '  volta install node@26',
  '',
  'Windows, current shell only (hash the PATH change if `node -v` still lies):',
  '  $env:PATH = "<path-to-node-26>;$env:PATH"; node -v',
].join('\n');

console.error(`\n${fixed}\n`);
process.exit(1);
