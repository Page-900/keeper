import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLI_PACKAGE } from '../src/brickken/cli.js';
import type { RequestRecord } from '../src/brickken/log.js';
import {
  SKILLS_DIRECTORY,
  SKILL_NAME,
  confirmSkill,
  installSkill,
  type SkillRecord,
} from '../src/brickken/skill.js';
import { readRecords } from '../src/shared/jsonl.js';
import { childEnvKeeping } from '../src/shared/secrets.js';
import { captureError } from './support/capture-error.js';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));

const DESCRIPTION = 'Helps an agent choose between the Brickken API, SDK, MCP and CLI.';
const MANIFEST = ['---', `name: ${SKILL_NAME}`, `description: ${DESCRIPTION}`, '---', ''].join(
  '\n',
);

let directory: string;
let root: string;
let file: string;
let installs: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-skill-'));
  root = join(directory, 'vendor');
  file = join(directory, 'brickken-requests.jsonl');
  installs = join(directory, 'skill-installs.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const arrive = (manifest = MANIFEST): void => {
  mkdirSync(join(root, SKILL_NAME), { recursive: true });
  writeFileSync(join(root, SKILL_NAME, 'SKILL.md'), manifest, 'utf8');
};

const install = (run: () => Promise<string> = () => (arrive(), Promise.resolve('installed'))) =>
  installSkill({ file, installs, root, run });

const records = () => readRecords<RequestRecord>(file);
const written = () => readRecords<SkillRecord>(installs);

describe('the skill is an artifact we install, recorded like every other surface', () => {
  it('records the install against the skill surface, pinning the tool that ran it', async () => {
    await install();

    expect(records()).toEqual([
      expect.objectContaining({ surface: 'skill', method: 'skill install', path: CLI_PACKAGE }),
    ]);
    expect(records()[0]?.path).toMatch(/@\d+\.\d+\.\d+$/);
  });

  it('writes only what it read, and never a list of methods it did not call', async () => {
    const installed = await install();

    expect(Object.keys(installed)).toEqual(['at', 'artifact', 'command', 'declares', 'files']);
    expect(written()).toEqual([installed]);
  });

  it('hashes every file that arrived, so the entry can be checked instead of believed', async () => {
    const installed = await install();
    const only = installed.files[0];

    expect(installed.files).toHaveLength(1);
    expect(only?.name).toBe('SKILL.md');
    expect(only?.bytes).toBe(Buffer.byteLength(MANIFEST));
    expect(only?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records a command another machine can run, never an absolute path off this one', async () => {
    const installed = await install();

    expect(installed.command).toContain('skill install --path ./');
    expect(installed.command).not.toMatch(/--path (\/|[A-Za-z]:)/);
  });

  it('takes the name and the description out of the artifact rather than naming it for them', async () => {
    const installed = await install();

    expect(installed.declares).toEqual({ name: SKILL_NAME, description: DESCRIPTION });
  });

  it('leaves the declaration empty when the artifact declares nothing', async () => {
    const installed = await install(() => (arrive('# Brickken\n'), Promise.resolve('installed')));

    expect(installed.declares).toEqual({});
  });
});

describe('an install that left nothing behind is a failure, never a quiet success', () => {
  it('refuses a command that reported success while no skill arrived', async () => {
    const error = await captureError(() => install(() => Promise.resolve('done')));

    expect(error.kind).toBe('skillUnverified');
    expect(records()).toEqual([expect.objectContaining({ surface: 'skill', outcome: 'failure' })]);
    expect(written()).toEqual([]);
  });

  it('records a tool that could not run at all', async () => {
    const refused = install(() => Promise.reject(new Error('spawn failed')));

    await expect(refused).rejects.toThrow('spawn failed');
    expect(records()).toEqual([expect.objectContaining({ surface: 'skill', outcome: 'failure' })]);
  });
});

describe('the check re-reads the files on disk instead of trusting the record', () => {
  it('passes on the artifact exactly as it was installed', async () => {
    const installed = await install();

    expect(confirmSkill({ installs, root })).toEqual(installed);
  });

  it('reports a file that changed after it was recorded', async () => {
    await install();
    writeFileSync(join(root, SKILL_NAME, 'SKILL.md'), `${MANIFEST}and one more line\n`, 'utf8');

    const error = await captureError(() => Promise.resolve(confirmSkill({ installs, root })));

    expect(error.kind).toBe('skillUnverified');
  });

  it('reports a file that was added after it was recorded', async () => {
    await install();
    writeFileSync(join(root, SKILL_NAME, 'EXTRA.md'), 'not from them\n', 'utf8');

    const error = await captureError(() => Promise.resolve(confirmSkill({ installs, root })));

    expect(error.kind).toBe('skillUnverified');
  });

  it('refuses to pass when nothing was ever installed', async () => {
    const error = await captureError(() => Promise.resolve(confirmSkill({ installs, root })));

    expect(error.kind).toBe('skillUnverified');
  });
});

const ignoredByGit = (path: string): boolean => {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { cwd: APP_ROOT });
    return true;
  } catch {
    return false;
  }
};

describe('their artifact is installed here and never redistributed', () => {
  it('keeps the directory it installs into out of git', () => {
    expect(ignoredByGit(join(SKILLS_DIRECTORY, SKILL_NAME, 'SKILL.md'))).toBe(true);
  });

  it('hands the install none of our secrets, because a download needs no credential', () => {
    const envFile = join(directory, '.env');
    writeFileSync(
      envFile,
      ['BRICKKEN_API_KEY=keeper-test-key-8802', `PRINCIPAL_PRIVATE_KEY=0x${'cd'.repeat(32)}`].join(
        '\n',
      ),
      'utf8',
    );
    vi.stubEnv('BRICKKEN_API_KEY', 'keeper-test-key-8802');
    vi.stubEnv('PRINCIPAL_PRIVATE_KEY', `0x${'cd'.repeat(32)}`);

    const child = childEnvKeeping([], envFile);

    expect(child['BRICKKEN_API_KEY']).toBeUndefined();
    expect(child['PRINCIPAL_PRIVATE_KEY']).toBeUndefined();
  });
});
