import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Anchor } from '../src/chain/anchors.js';
import { EVIDENCE_DOC, evidence, hashesIn, proof } from '../src/evidence.js';
import { captureError } from './support/capture-error.js';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-evidence-doc-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const write = (name: string, records: readonly object[]): string => {
  const file = join(directory, name);
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join('\n'), 'utf8');
  return file;
};

const anchor = (fields: Partial<Anchor> = {}): Anchor => ({
  at: '2026-08-25T00:00:00.000Z',
  action: 'grant-mandate',
  chainId: 11155111,
  transactionHash: `0x${'ab'.repeat(32)}`,
  blockNumber: '11558285',
  status: 'success',
  contract: null,
  gasUsed: '120000',
  ...fields,
});

describe('the page a judge reads is the records, rendered', () => {
  it('holds a page that is in step with the records behind it', () => {
    expect(readFileSync(EVIDENCE_DOC, 'utf8')).toBe(evidence());
  });

  it('leaves out no transaction this project ever sent', () => {
    const page = evidence();

    const missing = hashesIn(proof()).filter((hash) => !page.includes(hash));
    expect(missing).toEqual([]);
  });

  it('links every hash it shows, so a claim is five seconds from being checked', () => {
    const page = evidence();

    for (const hash of hashesIn(proof()))
      expect(page).toContain(`(https://sepolia.etherscan.io/tx/${hash})`);
  });

  it('says which cases were measured where nothing was sent, and why they carry no hash', () => {
    expect(evidence()).toContain('carry no transaction hash, because nothing was sent');
  });

  it('names what was not measured rather than letting the tables imply it was', () => {
    const page = evidence();

    expect(page).toContain('is not measured');
    expect(page).toContain('is not tested');
  });

  it('refuses a run with no transactions, so a deleted file cannot pass as a clean one', async () => {
    const error = await captureError(() =>
      Promise.resolve().then(() => proof({ anchors: write('empty.jsonl', []) })),
    );

    expect(error.kind).toBe('refusalUnattributable');
  });

  it('counts one transaction once, however many times it was recorded', () => {
    const twice = write('twice.jsonl', [anchor(), anchor()]);

    expect(proof({ anchors: twice }).anchors).toHaveLength(1);
  });
});
