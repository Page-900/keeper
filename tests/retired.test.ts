import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recordRetired, retiredSpend } from '../src/chain/retired.js';
import { requireAddress } from '../src/shared/config.js';

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-retired-'));
  file = join(directory, 'retired-mandates.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const sunl = (whole: bigint): string => String(whole * 10n ** 18n);

describe('what a replaced mandate spent is remembered, because the chain forgets it', () => {
  it('reads nothing as nothing, so a project that never replaced one is unaffected', () => {
    expect(retiredSpend(file)).toBe(0n);
  });

  it('adds up every mandate that was replaced, not only the last', () => {
    recordRetired(file, {
      agent: requireAddress('agent'),
      atBlock: '11673000',
      cumulativeUsed: sunl(500n),
    });
    recordRetired(file, {
      agent: requireAddress('router'),
      atBlock: '11680000',
      cumulativeUsed: sunl(250n),
    });

    expect(retiredSpend(file)).toBe(750n * 10n ** 18n);
  });

  it('stamps each record with the time and keeps the block it was read at', () => {
    const record = recordRetired(file, {
      agent: requireAddress('agent'),
      atBlock: '11673000',
      cumulativeUsed: sunl(500n),
    });

    expect(record.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record.atBlock).toBe('11673000');
  });
});
