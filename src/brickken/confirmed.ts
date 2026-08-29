import { ANCHOR_FILE, confirmAnchor, refuseRepeat, type AnchorAction } from '../chain/anchors.js';
import { transactionReceipt, type Receipt } from '../chain/client.js';
import { KeeperError } from '../shared/errors.js';
import { EVIDENCE_FILE, sdkWrite } from './log.js';
import type { PrepareMethod, WriteResult } from './sdk.js';
import { settledHash, type Settled, type Settlement } from './settlement.js';

export interface ConfirmRun {
  file?: string;
  anchors?: string;
  receipt?: (hash: `0x${string}`) => Promise<Receipt>;
}

/** One write, one anchor: the hash comes from their records and the status from the chain. */
export async function sendAndConfirm(
  action: AnchorAction,
  method: PrepareMethod,
  settled: Settled,
  { file = EVIDENCE_FILE, anchors = ANCHOR_FILE, receipt = transactionReceipt }: ConfirmRun,
  send: () => Promise<WriteResult>,
): Promise<Settlement> {
  refuseRepeat(action, anchors);
  const result = await sdkWrite(file, method, send);
  if (result.sent === undefined)
    throw new KeeperError('writeUnconfirmed', 'the write prepared but never sent');
  const transactionHash = await settledHash(settled, result.txId);
  const { status } = await confirmAnchor(action, transactionHash, { file: anchors, receipt });
  if (status !== 'success') throw new KeeperError('writeUnconfirmed', `${action} is ${status}`);
  return { txId: result.txId, transactionHash };
}
