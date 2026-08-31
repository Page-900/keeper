import { spawnSync } from 'node:child_process';

import { CHECKS, FAILED, PASSED, render, report } from './checks.js';
import { RUNNERS } from './confirmations.js';

const print = (text) => process.stdout.write(`${text}\n`);

function runScript(script) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const finished = spawnSync(npm, ['run', script], { encoding: 'utf8', shell: true });
  if (finished.error) return { status: FAILED, output: finished.error.message };
  const output = `${finished.stdout}${finished.stderr}`;
  return finished.status === 0 ? { status: PASSED } : { status: FAILED, output };
}

const explain = (check, detail) =>
  check.whenFailed === undefined ? detail : `${check.whenFailed}\n\n${detail}`;

async function execute(check) {
  const runner = RUNNERS[check.id];
  try {
    if (runner) return { status: PASSED, detail: await runner() };
    if (!check.script) return { status: FAILED, output: 'This check has no way to run.' };
    return runScript(check.script);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { status: FAILED, output: explain(check, detail) };
  }
}

const results = new Map();

try {
  for (const check of CHECKS) {
    print(`running: ${check.title}`);
    results.set(check.id, await execute(check));
  }
} finally {
  const summary = report(results);
  print(render(summary));
  for (const row of summary.rows.filter((row) => row.status !== PASSED)) {
    print(`--- ${row.check.title} ---`);
    print(
      row.output === '' ? 'This check never ran, so nothing about it is verified.' : row.output,
    );
  }
  process.exitCode = summary.verified ? 0 : 1;
}
