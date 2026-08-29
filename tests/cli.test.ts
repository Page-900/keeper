import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLI_PACKAGE, SAFE_ARGUMENT, readMandateOverCli } from '../src/brickken/cli.js';
import type { RequestRecord } from '../src/brickken/log.js';
import { readRecords } from '../src/shared/jsonl.js';
import { childEnvKeeping } from '../src/shared/secrets.js';
import { captureError } from './support/capture-error.js';

const ANSWER = {
  mandate: {
    agent: `0x${'11'.repeat(20)}`,
    principal: `0x${'22'.repeat(20)}`,
    asset: `0x${'33'.repeat(20)}`,
    revoked: false,
    maxTransactionValue: '250000000000000000000',
    maxCumulativeValue: '1000000000000000000000',
    cumulativeUsed: '250000000000000000000',
  },
  status: 'active',
  frozen: false,
  nonce: '1',
};

const printed = (body: unknown) => `RAMS mandate\n${JSON.stringify(body, null, 2)}\n`;

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-cli-'));
  file = join(directory, 'brickken-requests.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const records = () => readRecords<RequestRecord>(file);

describe('their command line tool is a surface we use, recorded like any other', () => {
  it('reads the mandate and records the command against the CLI surface', async () => {
    const reading = await readMandateOverCli({ file, run: () => Promise.resolve(printed(ANSWER)) });

    expect(reading.mandate.cumulativeUsed).toBe('250000000000000000000');
    expect(records()).toEqual([
      expect.objectContaining({ surface: 'cli', method: 'rams inspect', path: CLI_PACKAGE }),
    ]);
  });

  it('pins the version that ran, or the reading cannot be reproduced', async () => {
    await readMandateOverCli({ file, run: () => Promise.resolve(printed(ANSWER)) });

    expect(records()[0]?.path).toMatch(/@\d+\.\d+\.\d+$/);
  });

  it('asks for the chain, the agent and the principal, and nothing else', async () => {
    const seen: string[][] = [];
    await readMandateOverCli({
      file,
      run: (args) => {
        seen.push(args);
        return Promise.resolve(printed(ANSWER));
      },
    });

    expect(seen[0]?.slice(0, 4)).toEqual(['rams', 'inspect', '--chain', '11155111']);
  });
});

describe('an unusable answer from their tool is a failure, never a blank reading', () => {
  it('refuses output carrying no JSON at all', async () => {
    const error = await captureError(() =>
      readMandateOverCli({ file, run: () => Promise.resolve('command not found') }),
    );

    expect(error.kind).toBe('brickkenUnreadable');
    expect(records()).toEqual([expect.objectContaining({ surface: 'cli', outcome: 'failure' })]);
  });

  it('refuses JSON that carries no mandate rather than reporting an empty one', async () => {
    const error = await captureError(() =>
      readMandateOverCli({ file, run: () => Promise.resolve(printed({ status: 'active' })) }),
    );

    expect(error.kind).toBe('brickkenUnreadable');
    expect(records().at(-1)).toMatchObject({ outcome: 'failure' });
  });

  it('records a tool that failed to run at all', async () => {
    const refused = readMandateOverCli({
      file,
      run: () => Promise.reject(new Error('spawn failed')),
    });

    await expect(refused).rejects.toThrow('spawn failed');
    expect(records()).toEqual([expect.objectContaining({ surface: 'cli', outcome: 'failure' })]);
  });
});

describe('a vendor tool is given one credential and never the rest', () => {
  it('strips every other secret from the child environment it would inherit', () => {
    const envFile = join(directory, '.env');
    writeFileSync(
      envFile,
      ['BRICKKEN_API_KEY=keeper-test-key-4471', `PRINCIPAL_PRIVATE_KEY=0x${'ab'.repeat(32)}`].join(
        '\n',
      ),
      'utf8',
    );
    vi.stubEnv('BRICKKEN_API_KEY', 'keeper-test-key-4471');
    vi.stubEnv('PRINCIPAL_PRIVATE_KEY', `0x${'ab'.repeat(32)}`);

    const child = childEnvKeeping(['BRICKKEN_API_KEY'], envFile);

    expect(child['BRICKKEN_API_KEY']).toBe('keeper-test-key-4471');
    expect(child['PRINCIPAL_PRIVATE_KEY']).toBeUndefined();
  });
});

describe('a shell parses the arguments on Windows, so it is never handed a surprise', () => {
  it('accepts the arguments this project actually builds', () => {
    const built = ['rams', 'inspect', '--chain', '11155111', `0x${'11'.repeat(20)}`, CLI_PACKAGE];

    expect(built.every((argument) => SAFE_ARGUMENT.test(argument))).toBe(true);
  });

  it('refuses anything a shell could reinterpret', () => {
    const nasty = ['a b', 'a&b', 'a|b', 'a;b', 'a>b', 'a$(b)', 'a`b`', "a'b", 'a"b', ''];

    expect(nasty.filter((argument) => SAFE_ARGUMENT.test(argument))).toEqual([]);
  });
});
