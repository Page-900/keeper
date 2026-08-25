import { fileURLToPath } from 'node:url';

import { appendRecord } from '../shared/jsonl.js';
import { scrubError } from '../shared/secrets.js';
import { writePath } from './sdk.js';

/** Resolved from this module, so the file cannot follow the working directory. */
export const EVIDENCE_FILE = fileURLToPath(
  new URL('../../evidence/brickken-requests.jsonl', import.meta.url),
);

export type BrickkenSurface = 'rest' | 'sdk' | 'mcp' | 'cli' | 'skill';

export interface RequestRecord {
  at: string;
  surface: BrickkenSurface;
  method: string;
  path: string;
  /** Whether Brickken accepted the request, not whether we could use what came back. */
  outcome: 'success' | 'failure';
  status?: number;
  /** Their id for a prepared write. It is 32 bytes of hex, so it never rides in the path. */
  txId?: string;
}

/** Every write to Brickken is recorded before its outcome is known, refusals included. */
export async function recorded<T>(file: string, method: string, run: () => Promise<T>): Promise<T> {
  const attempt: Omit<RequestRecord, 'outcome'> = {
    at: new Date().toISOString(),
    surface: 'sdk',
    method,
    path: writePath(method),
  };
  const record = (outcome: RequestRecord['outcome']): RequestRecord => ({ ...attempt, outcome });
  try {
    const value = await run();
    appendRecord(file, record('success'));
    return value;
  } catch (cause) {
    appendRecord(file, record('failure'));
    throw scrubError(cause);
  }
}
