/**
 * Two processes, one `dev`: `tsc` in watch mode, and `node --watch` on its output.
 *
 * A plain `tsc --watch && node --watch` does not exist on Windows (no `&&` for parallel work,
 * no job control), and adding a task runner for two processes is more machinery than this
 * earns. This supervises both, forwards their output, and takes them down together.
 */
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Without this, `node --watch dist/main.js` races the first compile and prints MODULE_NOT_FOUND.
const first = spawnSync('tsc -p tsconfig.build.json', {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
if (first.status !== 0) process.exit(first.status ?? 1);

const children = [
  spawn('tsc -p tsconfig.build.json --watch --preserveWatchOutput', {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  }),
  spawn('node --watch --env-file-if-exists=../../.env dist/main.js', {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  }),
];

let shuttingDown = false;

for (const child of children) {
  child.on('exit', (code) => {
    if (shuttingDown) return;
    // One leg down means `dev` is broken: stop the other and say so, rather than half-run.
    console.error(`worker dev: a process exited with ${code ?? 'no code'} — stopping.`);
    shutdown(code ?? 1);
  });
}

function shutdown(code) {
  shuttingDown = true;
  for (const child of children) child.kill();
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));
