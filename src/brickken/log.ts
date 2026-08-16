import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
}

export function recordRequest(file: string, record: RequestRecord): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
}

export function readRequestLog(file: string): RequestRecord[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as RequestRecord);
}
