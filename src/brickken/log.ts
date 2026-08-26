import { fileURLToPath } from 'node:url';

import { appendRecord } from '../shared/jsonl.js';
import { scrubError } from '../shared/secrets.js';
import { writePath, type PrepareMethod } from './sdk.js';

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
  /** Whether Brickken accepted it. Over MCP an answer we cannot read is a failure too. */
  outcome: 'success' | 'failure';
  status?: number;
  /** Their id for a prepared write. It is 32 bytes of hex, so it never rides in the path. */
  txId?: string;
}

export type Attempt = Pick<RequestRecord, 'surface' | 'method' | 'path'>;

/** Every call to Brickken is recorded before its outcome is known, refusals included. */
export async function recorded<T>(
  file: string,
  attempt: Attempt,
  run: () => Promise<T>,
): Promise<T> {
  const at = new Date().toISOString();
  /** Named one by one: a spread would let a caller restamp `at` or smuggle a field. */
  const record = (outcome: RequestRecord['outcome']): RequestRecord => ({
    at,
    surface: attempt.surface,
    method: attempt.method,
    path: attempt.path,
    outcome,
  });
  try {
    const value = await run();
    appendRecord(file, record('success'));
    return value;
  } catch (cause) {
    appendRecord(file, record('failure'));
    throw scrubError(cause);
  }
}

/** The surface is named at every call site, because a default is how it came to be wrong. */
export const sdkWrite = <T>(
  file: string,
  method: PrepareMethod,
  run: () => Promise<T>,
): Promise<T> => recorded(file, { surface: 'sdk', method, path: writePath(method) }, run);
