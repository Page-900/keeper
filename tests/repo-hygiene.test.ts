import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MODEL_KEY_VARIABLE } from '../src/keeper/model.js';

/** This gate walks the whole repository, which is seconds of real work under a full run. */
const SCAN_TIMEOUT = 30_000;

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));

const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

const textUnder = (dir: URL): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? textUnder(new URL(`${entry.name}/`, dir))
      : [readFileSync(new URL(entry.name, dir), 'utf8')],
  );

const NEWLINE = /\r?\n/;

const exampleNames = (): string[] =>
  read('.env.example')
    .split(NEWLINE)
    .filter((line) => !line.trimStart().startsWith('#') && line.includes('='))
    .map((line) => line.slice(0, line.indexOf('=')).trim());

// Run from outside the repository, so a check that reads it fails instead of passing.
const startedIn = process.cwd();
beforeAll(() => {
  process.chdir(tmpdir());
});
afterAll(() => {
  process.chdir(startedIn);
});

describe('a private key never leaves .env', () => {
  it('gitignores .env and every .env variant except the example', () => {
    const gitignore = read('.gitignore');
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('!.env.example');
  });

  it('keeps .env out of the git index', () => {
    const tracked = execFileSync('git', ['ls-files'], {
      encoding: 'utf8',
      cwd: APP_ROOT,
    }).split('\n');
    expect(tracked.filter((f) => f === '.env' || f.startsWith('.env.'))).toEqual(['.env.example']);
  });

  it('names the model key in the example, so a fresh clone knows what to fill in', () => {
    expect(read('.env.example')).toContain(`${MODEL_KEY_VARIABLE}=`);
  });

  it(
    'carries no variable the code stopped reading, which is how a dead key survives',
    { timeout: SCAN_TIMEOUT },
    () => {
      const code = ['src/', 'scripts/']
        .flatMap((dir) => textUnder(new URL(`../${dir}`, import.meta.url)))
        .concat(read('hardhat.config.ts'))
        .join('\n');

      expect(exampleNames().filter((name) => !code.includes(name))).toEqual([]);
    },
  );

  it('leaves every value in .env.example empty', () => {
    const assignments = read('.env.example')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .filter((line) => line.includes('='));

    expect(assignments.length).toBeGreaterThan(0);
    for (const line of assignments) {
      expect(line.slice(line.indexOf('=') + 1).trim()).toBe('');
    }
  });
});

describe('a node exit handler is called, never handed a function to call with the exit code', () => {
  it('passes no bare function reference to process.on', () => {
    const scripts = readdirSync(new URL('../scripts/', import.meta.url));
    const offenders = scripts
      .filter((file) => file.endsWith('.js'))
      .filter((file) => /process\.on\('exit',\s*[A-Za-z]/.test(read(`scripts/${file}`)));

    expect(offenders).toEqual([]);
  });
});

const scripts = (): Record<string, string> =>
  (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;

describe('a contract test file cannot be written and then left out of the run', () => {
  const named = (script: string): string[] => {
    const command = scripts()[script];
    if (command === undefined) throw new Error(`package.json has no ${script} script`);
    return [...command.matchAll(/contracts\/test\/(\w+)\.t\.sol/g)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    );
  };

  const files = (): string[] =>
    readdirSync(new URL('../contracts/test/', import.meta.url))
      .filter((entry) => entry.endsWith('.t.sol'))
      .map((entry) => entry.replace('.t.sol', ''));

  it('runs every contract test file in one of the two suites, and never neither', () => {
    const run = [...named('test:contracts'), ...named('test:fork')].sort();

    expect(files().sort()).toEqual(run);
  });

  it('keeps the suites apart, so a fork test never runs where no network is configured', () => {
    for (const name of named('test:fork')) expect(name.startsWith('Fork')).toBe(true);
    for (const name of named('test:contracts')) expect(name.startsWith('Fork')).toBe(false);
  });
});

describe('no script leans on an npm lifecycle hook, because they are turned off here', () => {
  it('chains a step it needs rather than naming it pre or post something', () => {
    const names = Object.keys(scripts());
    const dead = names.filter((name) => {
      const target = name.replace(/^(pre|post)/, '');
      return target !== name && names.includes(target);
    });

    expect(dead).toEqual([]);
  });
});
