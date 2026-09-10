import { fileURLToPath } from 'node:url';

import { appendRecord, readRecords } from '../shared/jsonl.js';

/** Resolved from this module, so the file cannot follow the working directory. */
export const RETIRED_FILE = fileURLToPath(
  new URL('../../evidence/retired-mandates.jsonl', import.meta.url),
);

export interface Retired {
  at: string;
  agent: `0x${string}`;
  atBlock: string;
  cumulativeUsed: string;
}

/** A grant writes a fresh mandate with the running total at zero, so what it spent is kept here. */
export function recordRetired(file: string, retired: Omit<Retired, 'at'>): Retired {
  const record: Retired = { at: new Date().toISOString(), ...retired };
  appendRecord(file, record);
  return record;
}

export const retiredSpend = (file: string = RETIRED_FILE): bigint =>
  readRecords<Retired>(file).reduce((total, one) => total + BigInt(one.cumulativeUsed), 0n);
