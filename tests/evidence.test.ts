import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EVIDENCE_FILE } from '../src/brickken/log.js';
import { ANCHOR_FILE } from '../src/chain/anchors.js';
import { REFUSAL_FILE } from '../src/chain/refusal.js';
import { REGISTRY_READ_FILE } from '../src/chain/registry.js';
import { appendRecord, readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';

const REAL_FILES: [string, string][] = [
  ['the anchor log', ANCHOR_FILE],
  ['the refusal log', REFUSAL_FILE],
  ['the Brickken request log', EVIDENCE_FILE],
  ['the registry read log', REGISTRY_READ_FILE],
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
