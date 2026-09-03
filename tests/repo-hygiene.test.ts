import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MODEL_KEY_VARIABLE } from '../src/keeper/model.js';

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

  it('carries no variable the code stopped reading, which is how a dead key survives', () => {
    const code = ['src/', 'scripts/']
      .flatMap((dir) => textUnder(new URL(`../${dir}`, import.meta.url)))
      .concat(read('hardhat.config.ts'))
      .join('\n');

    expect(exampleNames().filter((name) => !code.includes(name))).toEqual([]);
  });

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
