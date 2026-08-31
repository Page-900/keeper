import { NO_MANDATE_PRINCIPAL, UNCAPPED, requireAddress } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import type { RegistryRead } from './registry.js';

export const CLAUSES = [
  'asset',
  'no mandate',
  'window',
  'revoked',
  'action',
  'frozen',
  'per transaction cap',
  'cumulative cap',
] as const;

export type Clause = (typeof CLAUSES)[number];

export interface ClauseResult {
  clause: Clause;
  passed: boolean;
}

export interface Evaluation {
  allowed: boolean;
  firstFalse: Clause | null;
  clauses: ClauseResult[];
}

const sameAddress = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

/** The order is AgentMandate.canExecute then _mandateAllows, and the order is the whole point. */
function clauseResults(
  state: RegistryRead,
  amount: bigint,
  asset: string,
  now: bigint,
): ClauseResult[] {
  const perTransaction = BigInt(state.maxTransactionValue);
  const cumulative = BigInt(state.maxCumulativeValue);
  const used = BigInt(state.cumulativeUsed);
  return [
    { clause: 'asset', passed: sameAddress(state.mandateAsset, asset) },
    { clause: 'no mandate', passed: !sameAddress(state.mandatePrincipal, NO_MANDATE_PRINCIPAL) },
    {
      clause: 'window',
      passed: now >= BigInt(state.mandateValidFrom) && now <= BigInt(state.mandateValidUntil),
    },
    { clause: 'revoked', passed: !state.mandateRevoked },
    { clause: 'action', passed: state.actionEnabled },
    { clause: 'frozen', passed: !state.agentFrozen },
    {
      clause: 'per transaction cap',
      passed: perTransaction === UNCAPPED || amount <= perTransaction,
    },
    {
      clause: 'cumulative cap',
      passed: cumulative === UNCAPPED || used + amount <= cumulative,
    },
  ];
}

/** The clock defaults to the block that was read, which is what attributing a past revert needs. */
export function evaluate(
  state: RegistryRead,
  amount: bigint,
  asset: string = requireAddress('asset'),
  nowSeconds: bigint = BigInt(state.blockTimestamp),
): Evaluation {
  const clauses = clauseResults(state, amount, asset, nowSeconds);
  const failed = clauses.find((result) => !result.passed);
  return {
    allowed: failed === undefined,
    firstFalse: failed?.clause ?? null,
    clauses,
  };
}

/** The chain is the authority. A reader that disagrees with it is wrong and says so loudly. */
export function agreeWithChain(evaluation: Evaluation, canExecute: boolean): Evaluation {
  if (evaluation.allowed !== canExecute)
    throw new KeeperError(
      'refusalUnattributable',
      `the reader says ${String(evaluation.allowed)} and canExecute says ${String(canExecute)}`,
    );
  return evaluation;
}
