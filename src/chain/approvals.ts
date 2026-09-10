import { fileURLToPath } from 'node:url';

import { appendRecord, readRecords } from '../shared/jsonl.js';

/** Resolved from this module, so the file cannot follow the working directory. */
export const APPROVAL_FILE = fileURLToPath(
  new URL('../../evidence/executor-approvals.jsonl', import.meta.url),
);

export interface Approval {
  at: string;
  amount: string;
  atBlock: string;
  /** Everything the executor had already drawn when this approval replaced the last one. */
  drawnBefore: string;
}

export function recordApproval(file: string, approval: Omit<Approval, 'at'>): Approval {
  const record: Approval = { at: new Date().toISOString(), ...approval };
  appendRecord(file, record);
  return record;
}

export const latestApproval = (file: string = APPROVAL_FILE): Approval | null =>
  readRecords<Approval>(file).at(-1) ?? null;

/** An approval sets the allowance rather than adding to it, so only spending since it counts. */
export const allowanceExpected = (approval: Approval, drawnNow: bigint): bigint =>
  BigInt(approval.amount) - (drawnNow - BigInt(approval.drawnBefore));
