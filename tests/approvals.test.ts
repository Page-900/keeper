import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { allowanceExpected, latestApproval, recordApproval } from '../src/chain/approvals.js';

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-approvals-'));
  file = join(directory, 'executor-approvals.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const sunl = (whole: bigint): string => String(whole * 10n ** 18n);
const base = (whole: bigint): bigint => whole * 10n ** 18n;

describe('an approval sets the allowance, so the check counts only what came after it', () => {
  it('reads no approval at all as nothing, which is a project that never approved twice', () => {
    expect(latestApproval(file)).toBeNull();
  });

  it('takes the last approval and never the first, because the last is the one in force', () => {
    recordApproval(file, { amount: sunl(2_000n), atBlock: '1', drawnBefore: '0' });
    recordApproval(file, { amount: sunl(5_000n), atBlock: '2', drawnBefore: sunl(503n) });

    expect(latestApproval(file)?.amount).toBe(sunl(5_000n));
  });

  it('expects the whole approval back when nothing has been drawn since it', () => {
    const approval = recordApproval(file, {
      amount: sunl(2_000n),
      atBlock: '1',
      drawnBefore: sunl(503n),
    });

    expect(allowanceExpected(approval, base(503n))).toBe(base(2_000n));
  });

  it('subtracts only what was drawn after it, never what was drawn before', () => {
    const approval = recordApproval(file, {
      amount: sunl(2_000n),
      atBlock: '1',
      drawnBefore: sunl(503n),
    });

    expect(allowanceExpected(approval, base(753n))).toBe(base(1_750n));
  });
});
