import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EVIDENCE_FILE } from '../src/brickken/log.js';
import { ANCHOR_FILE } from '../src/chain/anchors.js';
import {
  BATTERY_FILE,
  failedClauses,
  isolated,
  unanchoredClauses,
  type BatteryCase,
} from '../src/chain/battery.js';
import { CLAUSES } from '../src/chain/differential.js';
import { REFUSAL_FILE } from '../src/chain/refusal.js';
import { REGISTRY_READ_FILE } from '../src/chain/registry.js';
import { GUARD_FILE } from '../src/keeper/guard.js';
import { appendRecord, readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';

const REAL_FILES: [string, string][] = [
  ['the anchor log', ANCHOR_FILE],
  ['the refusal log', REFUSAL_FILE],
  ['the Brickken request log', EVIDENCE_FILE],
  ['the registry read log', REGISTRY_READ_FILE],
  ['the guard decision log', GUARD_FILE],
];

describe('what a real run captured cannot be added to by a test', () => {
  it.each(REAL_FILES)('refuses an invented record in %s', async (_name, file) => {
    const before = readRecords(file).length;

    const error = await captureError(() =>
      Promise.resolve().then(() => {
        appendRecord(file, { at: 'invented' });
      }),
    );

    expect(error.kind).toBe('evidenceProtected');
    expect(readRecords(file)).toHaveLength(before);
  });

  it('still writes anywhere else, so a test can use its own file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'keeper-evidence-'));
    const file = join(directory, 'records.jsonl');

    appendRecord(file, { at: 'kept' });

    expect(readRecords(file)).toHaveLength(1);
    rmSync(directory, { recursive: true, force: true });
  });
});

describe('every recorded refusal names the clause the contract would have failed on first', () => {
  const records = readRecords<BatteryCase>(BATTERY_FILE);

  it('has something to check, so a deleted evidence file cannot pass as a clean run', () => {
    expect(records.length).toBeGreaterThan(0);
  });

  it.each(records)('$case', (record) => {
    const failing = failedClauses(record);

    expect(record.clauses.map((result) => result.clause)).toEqual([...CLAUSES]);
    expect(record.firstFalse).toBe(failing[0]);
    expect(record.agreedWithChain).toBe(true);
  });

  it('separates the cases that stand alone from the ones the ordering names', () => {
    const alone = records.filter((record) => isolated(record)).map((record) => record.case);
    const ordered = records.filter((record) => !isolated(record)).map((record) => record.case);

    expect([...alone, ...ordered].sort()).toEqual(records.map((r) => r.case).sort());
    for (const record of records.filter((r) => !isolated(r)))
      expect(failedClauses(record).length).toBeGreaterThan(1);
  });

  it('leaves exactly the clauses no transaction of ours can reach', () => {
    expect(unanchoredClauses()).toEqual(['no mandate', 'frozen']);
  });
});
