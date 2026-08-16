import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));

const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

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
