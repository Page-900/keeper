import { fileURLToPath } from 'node:url';

import { CHAIN_ID, MANDATE_ACTIONS, requireAddress } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { appendRecord } from '../shared/jsonl.js';
import { agentCalldata } from './action.js';
import { EXECUTOR_ARTIFACT, REGISTRY_ARTIFACT, compiledArtifact } from './artifacts.js';
import { readValue, simulateRefusal, type RevertReason } from './client.js';
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
}

export interface RefusalChain {
  state: () => Promise<RegistryRead>;
  canExecute: (amount: bigint, atBlock: bigint) => Promise<boolean>;
  simulate: (amount: bigint) => Promise<RevertReason | null>;
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
  simulate: (amount) =>
    simulateRefusal(
      'agent',
      requireAddress('executor'),
      compiledArtifact(EXECUTOR_ARTIFACT),
      'execute',
      [requireAddress('asset'), agentCalldata(requireAddress('counterparty'), amount)],
    ),
};

export type ProvenRefusal = Omit<Refusal, 'at' | 'chainId'>;

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

export async function recordRefusal({
  chain = CHAIN,
  file = REFUSAL_FILE,
}: RefusalOptions = {}): Promise<Refusal> {
  const refusal: Refusal = {
    at: new Date().toISOString(),
    chainId: CHAIN_ID,
    ...(await proveRefusal(chain)),
  };
  appendRecord(file, refusal);
  return refusal;
}
