import { CHAIN_ID } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { scrubError } from '../shared/secrets.js';
import {
  confirmTransaction,
  sendTransaction,
  type ConfirmationStatus,
  type OutboundTransaction,
  type SignerRole,
} from './client.js';

export interface Sequence {
  transactions: OutboundTransaction[];
  /** An accepted write is not yet a state the next call may assume, so a read has to confirm it. */
  confirmState: () => Promise<boolean>;
}

export interface Submitter {
  send(role: SignerRole, transaction: OutboundTransaction): Promise<`0x${string}`>;
  confirm(hash: `0x${string}`): Promise<ConfirmationStatus>;
}

const CHAIN: Submitter = { send: sendTransaction, confirm: confirmTransaction };

/** Array order is not a promise. The nonce is. */
function inNonceOrder(transactions: OutboundTransaction[]): OutboundTransaction[] {
  if (transactions.length === 0)
    throw new KeeperError('sequenceMalformed', 'the prepared batch held no transactions');

  const ordered = [...transactions].sort((left, right) => left.nonce - right.nonce);
  let previous: OutboundTransaction | undefined;
  for (const transaction of ordered) {
    const nonce = String(transaction.nonce);
    if (transaction.chainId !== CHAIN_ID)
      throw new KeeperError(
        'sequenceMalformed',
        `nonce ${nonce} is prepared for chain ${String(transaction.chainId)}`,
      );
    if (previous?.nonce === transaction.nonce)
      throw new KeeperError(
        'sequenceMalformed',
        `nonce ${nonce} appears twice, so the second would replace the first`,
      );
    if (previous !== undefined && transaction.nonce !== previous.nonce + 1)
      throw new KeeperError('nonceGap', `nonce ${String(previous.nonce + 1)} is missing`);
    previous = transaction;
  }
  return ordered;
}

/** A node that times out or rejects leaves the write unproven, same as a revert. */
async function orUnconfirmed<T>(step: () => Promise<T>, detail: string): Promise<T> {
  try {
    return await step();
  } catch (cause) {
    if (cause instanceof KeeperError) throw cause;
    throw new KeeperError('writeUnconfirmed', `${detail}: ${scrubError(cause).message}`);
  }
}

/** Nothing is ever resent: a resend can broadcast twice on a nonce that has already mined. */
export async function submitSequence(
  role: SignerRole,
  sequence: Sequence,
  submitter: Submitter = CHAIN,
): Promise<`0x${string}`[]> {
  const hashes: `0x${string}`[] = [];
  for (const transaction of inNonceOrder(sequence.transactions)) {
    const at = `nonce ${String(transaction.nonce)}`;
    const hash = await orUnconfirmed(() => submitter.send(role, transaction), at);
    const status = await orUnconfirmed(() => submitter.confirm(hash), at);
    if (status !== 'success') throw new KeeperError('writeUnconfirmed', `${at} ${status}`);
    hashes.push(hash);
  }

  if (!(await orUnconfirmed(() => sequence.confirmState(), 'the read-back')))
    throw new KeeperError('writeUnconfirmed', 'the read-back did not report the state written');
  return hashes;
}
