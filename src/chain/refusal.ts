import { fileURLToPath } from 'node:url';

import { CHAIN_ID, MANDATE_ACTIONS, requireAddress } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { appendRecord } from '../shared/jsonl.js';
import { agentCalldata } from './action.js';
import {
  ANCHOR_FILE,
  confirmAnchor,
  refuseRepeat,
  type Anchor,
  type AnchorAction,
} from './anchors.js';
import { EXECUTOR_ARTIFACT, REGISTRY_ARTIFACT, compiledArtifact } from './artifacts.js';
import {
  readValue,
  simulateRefusal,
  transactionReceipt,
  writeWithGasLimit,
  type Receipt,
  type RevertReason,
} from './client.js';
import { readRegistryState, type RegistryRead } from './registry.js';

/** Resolved from this module, so the file cannot follow the working directory. */
export const REFUSAL_FILE = fileURLToPath(
  new URL('../../evidence/refusals.jsonl', import.meta.url),
);

export interface Refusal {
  at: string;
  chainId: number;
  blockNumber: string;
  rule: 'maxTransactionValue';
  decidedBy: 'mandate';
  reportedBy: 'executor';
  allowedAmount: string;
  refusedAmount: string;
  allowedAnswer: boolean;
  refusedAnswer: boolean;
  revert: RevertReason;
  state: RegistryRead;
  /** Null while the refusal is only simulated, and a hash once the chain has refused it. */
  transactionHash: `0x${string}` | null;
}

export interface RefusalChain {
  state: () => Promise<RegistryRead>;
  canExecute: (amount: bigint, atBlock: bigint) => Promise<boolean>;
  simulate: (amount: bigint, atBlock?: bigint) => Promise<RevertReason | null>;
}

const CHAIN: RefusalChain = {
  state: () => readRegistryState(),
  canExecute: async (amount, atBlock) => {
    const answer = await readValue(
      requireAddress('agentMandate'),
      compiledArtifact(REGISTRY_ARTIFACT),
      'canExecute',
      [
        requireAddress('agent'),
        requireAddress('principal'),
        requireAddress('asset'),
        MANDATE_ACTIONS[0],
        amount,
      ],
      atBlock,
    );
    if (typeof answer !== 'boolean')
      throw new KeeperError('readBackMismatch', 'canExecute() did not answer true or false');
    return answer;
  },
  simulate: (amount, atBlock) =>
    simulateRefusal(
      'agent',
      requireAddress('executor'),
      compiledArtifact(EXECUTOR_ARTIFACT),
      'execute',
      [requireAddress('asset'), agentCalldata(requireAddress('counterparty'), amount)],
      atBlock,
    ),
};

export type ProvenRefusal = Omit<Refusal, 'at' | 'chainId' | 'transactionHash'>;

export interface RefusalOptions {
  chain?: RefusalChain;
  file?: string;
}

/** canExecute bundles every rule into one boolean, so only a one unit change can attribute it. */
export async function proveRefusal(chain: RefusalChain = CHAIN): Promise<ProvenRefusal> {
  const state = await chain.state();
  const atBlock = BigInt(state.blockNumber);
  const allowedAmount = BigInt(state.maxTransactionValue);
  const refusedAmount = allowedAmount + 1n;
  const headroom = BigInt(state.maxCumulativeValue) - BigInt(state.cumulativeUsed);

  if (headroom < refusedAmount)
    throw new KeeperError(
      'refusalUnattributable',
      `${String(headroom)} is left under the lifetime cap, so it would refuse ${String(refusedAmount)} too`,
    );

  const allowedAnswer = await chain.canExecute(allowedAmount, atBlock);
  const refusedAnswer = await chain.canExecute(refusedAmount, atBlock);

  if (!allowedAnswer)
    throw new KeeperError(
      'refusalUnattributable',
      `the mandate refuses ${String(allowedAmount)}, which is inside the cap it published`,
    );
  if (refusedAnswer)
    throw new KeeperError(
      'refusalUnattributable',
      `the mandate permits ${String(refusedAmount)}, which is over the cap it published`,
    );

  const revert = await chain.simulate(refusedAmount);
  if (revert === null)
    throw new KeeperError(
      'refusalUnattributable',
      `the executor would run ${String(refusedAmount)} without reverting`,
    );

  return {
    blockNumber: String(atBlock),
    rule: 'maxTransactionValue',
    decidedBy: 'mandate',
    reportedBy: 'executor',
    allowedAmount: String(allowedAmount),
    refusedAmount: String(refusedAmount),
    allowedAnswer,
    refusedAnswer,
    revert,
    state,
  };
}

const writeRefusal = (
  file: string,
  proven: ProvenRefusal,
  transactionHash: `0x${string}` | null,
): Refusal => {
  const refusal: Refusal = {
    at: new Date().toISOString(),
    chainId: CHAIN_ID,
    ...proven,
    transactionHash,
  };
  appendRecord(file, refusal);
  return refusal;
};

export async function recordRefusal({
  chain = CHAIN,
  file = REFUSAL_FILE,
}: RefusalOptions = {}): Promise<Refusal> {
  return writeRefusal(file, await proveRefusal(chain), null);
}

const REFUSED: AnchorAction = 'agent-refusal';

/** A call meant to revert cannot be gas estimated, because the estimate is the revert. */
const GAS_LIMIT = 400_000n;

export interface RefusalSender {
  gasLimit: bigint;
  send: (amount: bigint) => Promise<`0x${string}`>;
  receipt: (hash: `0x${string}`) => Promise<Receipt>;
}

const SENDER: RefusalSender = {
  gasLimit: GAS_LIMIT,
  send: (amount) =>
    writeWithGasLimit(
      'agent',
      requireAddress('executor'),
      compiledArtifact(EXECUTOR_ARTIFACT),
      'execute',
      [requireAddress('asset'), agentCalldata(requireAddress('counterparty'), amount)],
      GAS_LIMIT,
    ),
  receipt: transactionReceipt,
};

export interface SentRefusal {
  refusal: Refusal;
  anchor: Anchor;
}

export interface SendOptions extends RefusalOptions {
  sender?: RefusalSender;
  anchors?: string;
}

/** The refusal is proved by free reads first, which is what makes the gas worth spending. */
export async function sendRefusedAction({
  chain = CHAIN,
  sender = SENDER,
  file = REFUSAL_FILE,
  anchors = ANCHOR_FILE,
}: SendOptions = {}): Promise<SentRefusal> {
  refuseRepeat(REFUSED, anchors, 'reverted');
  const proven = await proveRefusal(chain);
  const transactionHash = await sender.send(BigInt(proven.refusedAmount));
  const anchor = await confirmAnchor(REFUSED, transactionHash, {
    file: anchors,
    receipt: sender.receipt,
  });
  if (anchor.status !== 'reverted')
    throw new KeeperError('writeUnconfirmed', `${transactionHash} moved the token instead`);
  if (BigInt(anchor.gasUsed) >= sender.gasLimit)
    throw new KeeperError(
      'refusalUnattributable',
      `${transactionHash} used every one of its ${String(sender.gasLimit)} gas, so it ran out rather than being refused`,
    );
  const replayed = await chain.simulate(
    BigInt(proven.refusedAmount),
    BigInt(anchor.blockNumber) - 1n,
  );
  if (replayed?.error !== proven.revert.error)
    throw new KeeperError(
      'refusalUnattributable',
      `${transactionHash} reverted with ${replayed?.error ?? 'no reason'} where ${proven.revert.error} was expected`,
    );
  return { refusal: writeRefusal(file, proven, transactionHash), anchor };
}
