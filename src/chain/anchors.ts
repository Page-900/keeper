import { fileURLToPath } from 'node:url';

import { CHAIN_ID } from '../shared/config.js';
import { appendRecord } from '../shared/jsonl.js';

/** Resolved from this module, so the file cannot follow the working directory. */
export const ANCHOR_FILE = fileURLToPath(
  new URL('../../evidence/chain-anchors.jsonl', import.meta.url),
);

export type AnchorAction = 'deploy-executor' | 'register-action';

export interface Anchor {
  at: string;
  action: AnchorAction;
  chainId: number;
  transactionHash: `0x${string}`;
  /** Decimal string, because JSON numbers are approximate and chain values are not. */
  blockNumber: string;
  status: 'success' | 'reverted';
  /** Null whenever the transaction deployed nothing, which a reverted deploy does not. */
  contract: `0x${string}` | null;
}

export type Claim = Omit<Anchor, 'at' | 'chainId'>;

/** Written before the outcome is judged, so a refusal is captured as readily as a success. */
export function recordAnchor(file: string, claim: Claim): Anchor {
  const anchor: Anchor = { at: new Date().toISOString(), chainId: CHAIN_ID, ...claim };
  appendRecord(file, anchor);
  return anchor;
}
