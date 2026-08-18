import { fileURLToPath } from 'node:url';

import { CHAIN_ID } from '../shared/config.js';
import { appendRecord } from '../shared/jsonl.js';
import { transactionReceipt, type Receipt } from './client.js';

/** Resolved from this module, so the file cannot follow the working directory. */
export const ANCHOR_FILE = fileURLToPath(
  new URL('../../evidence/chain-anchors.jsonl', import.meta.url),
);

export type AnchorAction =
  | 'deploy-executor'
  | 'register-action'
  | 'create-token'
  | 'whitelist-holder'
  | 'mint-holding'
  | 'approve-executor';

export interface Anchor {
  at: string;
  action: AnchorAction;
  chainId: number;
  transactionHash: `0x${string}`;
  /** Decimal string, because JSON numbers are approximate and chain values are not. */
  blockNumber: string;
  status: 'success' | 'reverted';
  /** The contract the claim is about, and null when the transaction created none. */
  contract: `0x${string}` | null;
}

export type Claim = Omit<Anchor, 'at' | 'chainId'>;

/** Written before the outcome is judged, so a refusal is captured as readily as a success. */
export function recordAnchor(file: string, claim: Claim): Anchor {
  const anchor: Anchor = { at: new Date().toISOString(), chainId: CHAIN_ID, ...claim };
  appendRecord(file, anchor);
  return anchor;
}

export interface ConfirmOptions {
  file?: string;
  receipt?: (hash: `0x${string}`) => Promise<Receipt>;
}

/** The hash is the only input; every recorded fact is read from the chain. */
export async function confirmAnchor(
  action: AnchorAction,
  transactionHash: `0x${string}`,
  { file = ANCHOR_FILE, receipt = transactionReceipt }: ConfirmOptions = {},
): Promise<Anchor> {
  const { status, blockNumber, contractAddress } = await receipt(transactionHash);
  return recordAnchor(file, {
    action,
    transactionHash,
    blockNumber: String(blockNumber),
    status,
    contract: contractAddress,
  });
}
