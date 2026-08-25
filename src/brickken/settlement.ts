import { KeeperError } from '../shared/errors.js';
import type { TransactionStatus } from './client.js';

export interface Settled {
  settled: (txId: string) => Promise<TransactionStatus>;
}

export interface Settlement {
  txId: string;
  transactionHash: `0x${string}`;
}

/** The hash a send reports back is not the hash that mines, so their records are asked instead. */
export async function settledHash(sandbox: Settled, txId: string): Promise<`0x${string}`> {
  const { status, transactionHash } = await sandbox.settled(txId);
  if (status === 'rejected') throw new KeeperError('writeUnconfirmed', `Brickken rejected ${txId}`);
  if (transactionHash === null) throw new KeeperError('brickkenUnsettled', txId);
  return transactionHash;
}
