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
  /** Their id for a prepared write. It is 32 bytes of hex, so it never rides in the path. */
  txId?: string;
}
