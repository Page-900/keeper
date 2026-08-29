import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Anchor } from '../src/chain/anchors.js';
import type { RequestRecord } from '../src/brickken/log.js';
import type { SkillRecord } from '../src/brickken/skill.js';
import {
  SURFACES_FILE,
  declaration,
  declared,
  methodsUsed,
  repeatedMethods,
} from '../src/surfaces.js';

const at = '2026-08-28T10:00:00.000Z';

const request = (fields: Partial<RequestRecord>): RequestRecord => ({
  at,
  surface: 'rest',
  method: 'GET',
  path: '/get-token-info',
  outcome: 'success',
  ...fields,
});

const GRANT_HASH = `0x${'a7'.repeat(32)}` as const;

const anchor = (fields: Partial<Anchor> = {}): Anchor => ({
  at,
  action: 'grant-mandate',
  chainId: 11155111,
  transactionHash: GRANT_HASH,
  blockNumber: '11558285',
  status: 'success',
  contract: null,
  gasUsed: '120000',
  ...fields,
});

const install = (): SkillRecord => ({
  at,
  command: 'npx -y brickken-cli skill install',
  artifact: 'brickken',
  declares: { name: 'brickken-tools' },
  files: [{ name: 'SKILL.md', bytes: 10, sha256: 'aa' }],
});

let directory: string;

const write = (name: string, records: readonly object[]): string => {
  const file = join(directory, name);
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join('\n'), 'utf8');
  return file;
};

const from = (
  records: readonly RequestRecord[],
  anchors: readonly Anchor[] = [],
  installs: readonly SkillRecord[] = [install()],
): ReturnType<typeof declaration> =>
  declaration({
    requests: write('requests.jsonl', records),
    anchors: write('anchors.jsonl', anchors),
    installs: write('installs.jsonl', installs),
  });

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-surfaces-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const sectionFor = (found: ReturnType<typeof declaration>, surface: string) =>
  found.sections.find((section) => section.surface === surface);

describe('the declaration is read out of the evidence, never written from memory', () => {
  it('drops the query string, so one endpoint is one row however it was asked', () => {
    const records = [
      request({ path: '/get-balance-whitelist?tokenSymbol=SUNL&investorEmail=a%40example.com' }),
      request({ path: '/get-balance-whitelist?tokenSymbol=SUNL&investorEmail=b%40example.com' }),
    ];

    expect(methodsUsed(records, 'rest')).toEqual([
      { method: 'GET', path: '/get-balance-whitelist', answered: 'yes' },
    ]);
  });

  it('keeps a method whose name carries a space intact', () => {
    const records = [
      request({ surface: 'cli', method: 'rams inspect', path: 'brickken-cli@0.4.12' }),
    ];

    expect(methodsUsed(records, 'cli')).toEqual([
      { method: 'rams inspect', path: 'brickken-cli@0.4.12', answered: 'yes' },
    ]);
  });

  it('separates a call that always worked from one that sometimes did and one that never did', () => {
    const records = [
      request({ surface: 'sdk', method: 'whitelist', path: '/prepare-transactions' }),
      request({ surface: 'sdk', method: 'mintToken', path: '/prepare-transactions' }),
      request({
        surface: 'sdk',
        method: 'mintToken',
        path: '/prepare-transactions',
        outcome: 'failure',
      }),
      request({
        surface: 'sdk',
        method: 'burnToken',
        path: '/prepare-transactions',
        outcome: 'failure',
      }),
    ];

    expect(methodsUsed(records, 'sdk').map((row) => [row.method, row.answered])).toEqual([
      ['burnToken', 'no'],
      ['mintToken', 'not every time'],
      ['whitelist', 'yes'],
    ]);
  });

  it('reports a method that reached two paths instead of choosing the newer one', () => {
    const records = [
      request({ surface: 'sdk', method: 'ramsExecute', path: '/prepare-transactions' }),
      request({ surface: 'sdk', method: 'ramsExecute', path: '/x402/rams/execute' }),
    ];
    const found = from(records);

    expect(repeatedMethods(methodsUsed(records, 'sdk'))).toEqual(['ramsExecute']);
    expect(sectionFor(found, 'sdk')?.methods).toHaveLength(2);
    expect(declared({ requests: write('requests.jsonl', records) })).toContain(
      'reported rather than merged: ramsExecute',
    );
  });

  it('does not call an HTTP verb a repeated method, because every endpoint shares it', () => {
    const records = [
      request({ path: '/get-token-info' }),
      request({ path: '/get-whitelist-status' }),
    ];

    expect(sectionFor(from(records), 'rest')?.repeated).toEqual([]);
  });
});

describe('the skill is declared as an artifact and never as a list of calls', () => {
  it('names it from the install evidence, which the request log cannot describe', () => {
    const text = declared({
      requests: write('requests.jsonl', [request({ surface: 'skill', method: 'skill install' })]),
      installs: write('installs.jsonl', [install()]),
    });

    expect(text).toContain('brickken-tools');
    expect(text).toContain('| Artifact | Installed by | Files |');
    expect(text).not.toContain('| skill install |');
  });
});

describe('a call made before the log existed is declared, not quietly dropped', () => {
  it('points at the chain anchor for the grant while the log holds no record of it', () => {
    const found = from([request({})], [anchor()]);

    expect(found.unlogged?.transactionHash).toBe(GRANT_HASH);
  });

  it('stops saying so as soon as the log holds the grant itself', () => {
    const granted = request({ surface: 'sdk', method: 'ramsGrantMandate', path: '/x402/rams' });

    expect(from([granted], [anchor()]).unlogged).toBeNull();
  });

  it('says nothing about a grant that never landed', () => {
    expect(from([request({})], [anchor({ status: 'reverted' })]).unlogged).toBeNull();
  });
});

describe('the declaration and the evidence cannot drift apart', () => {
  it('holds the file in the repository against a fresh reading of the evidence', () => {
    expect(readFileSync(SURFACES_FILE, 'utf8')).toBe(declared());
  });
});
