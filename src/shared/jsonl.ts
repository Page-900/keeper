import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KeeperError } from './errors.js';

const EVIDENCE_DIRECTORY = fileURLToPath(new URL('../../evidence/', import.meta.url));

/** An invented record among the real ones would be undetectable afterwards, so it never gets in. */
const refuseInventedRecord = (file: string): void => {
  if (process.env['VITEST'] !== undefined && file.startsWith(EVIDENCE_DIRECTORY))
    throw new KeeperError('evidenceProtected', file);
};

/** Appended and never rewritten, so a captured claim cannot be edited after the fact. */
export function appendRecord(file: string, record: object): void {
  refuseInventedRecord(file);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
}

export function readRecords<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as T);
}
