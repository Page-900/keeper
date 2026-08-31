import { fileURLToPath } from 'node:url';

import { readTokenBalance } from '../chain/client.js';
import { evaluate, type Clause } from '../chain/differential.js';
import { sunlAmount, utc } from '../chain/mandate.js';
import { readRegistryState, type RegistryRead } from '../chain/registry.js';
import { PERMITTED_ACTION, requireAddress } from '../shared/config.js';
import { appendRecord } from '../shared/jsonl.js';
import type { DeliverIntent, Intent } from './intent.js';
import { POLICY, policyBreaches, type Policy } from './policy.js';

export const GUARD_FILE = fileURLToPath(
  new URL('../../evidence/guard-decisions.jsonl', import.meta.url),
);

export type RefusalSource = 'policy' | 'mandate bound' | 'compliance';

export interface GuardRefusal {
  rule: string;
  detail: string;
  source: RefusalSource;
}

export type Verdict = 'proceed' | 'refused' | 'declined';

export interface Decision {
  at: string;
  decidedBy: 'app';
  verdict: Verdict;
  refusals: GuardRefusal[];
  action: Intent['action'];
  amount: string;
  pricePerToken: string;
  recipient: `0x${string}` | null;
  rationale: string;
  holding: string | null;
  buyerHolds: string | null;
  state: RegistryRead | null;
}

export interface GuardReads {
  state: () => Promise<RegistryRead>;
  balance: (holder: `0x${string}`, atBlock: bigint) => Promise<bigint>;
}

const CHAIN: GuardReads = {
  state: () => readRegistryState(),
  balance: (holder, atBlock) => readTokenBalance(requireAddress('asset'), holder, atBlock),
};

function clauseDetail(clause: Clause, amount: bigint, state: RegistryRead, now: bigint): string {
  const used = BigInt(state.cumulativeUsed);
  const details: Record<Clause, string> = {
    asset: `the mandate covers ${state.mandateAsset} and not ${requireAddress('asset')}`,
    'no mandate': `the registry holds none for ${state.agent}`,
    window: `the mandate runs ${utc(BigInt(state.mandateValidFrom))} to ${utc(BigInt(state.mandateValidUntil))} and it is now ${utc(now)}`,
    revoked: 'the principal has revoked this mandate',
    action: `${PERMITTED_ACTION.signature} is not enabled`,
    frozen: `${state.agent} is frozen`,
    'per transaction cap': `${sunlAmount(amount)} is over the ${sunlAmount(BigInt(state.maxTransactionValue))} allowed at once`,
    'cumulative cap': `${sunlAmount(used + amount)} spent in total is over the ${sunlAmount(BigInt(state.maxCumulativeValue))} allowed`,
  };
  return details[clause];
}

/** Read from differential.ts and never re-derived, so one edit cannot make the two disagree. */
function boundBreaches(amount: bigint, state: RegistryRead, nowSeconds: number): GuardRefusal[] {
  const now = BigInt(nowSeconds);
  const breaches = evaluate(state, amount, requireAddress('asset'), now)
    .clauses.filter((result) => !result.passed)
    .map((result): GuardRefusal => ({
      rule: result.clause,
      detail: clauseDetail(result.clause, amount, state, now),
      source: 'mandate bound',
    }));
  if (state.principalEligible) return breaches;
  return [
    ...breaches,
    {
      rule: 'eligibility',
      detail: `the compliance provider does not clear the principal, reason ${String(state.eligibilityReason)}, so a fresh mandate could not be granted`,
      source: 'compliance',
    },
  ];
}

interface Reading {
  holding: bigint;
  buyerHolds: bigint;
  state: RegistryRead;
}

const judge = (
  intent: DeliverIntent,
  reading: Reading,
  policy: Policy,
  nowSeconds: number,
): GuardRefusal[] => [
  ...policyBreaches(
    {
      amount: intent.amount,
      pricePerToken: intent.pricePerToken,
      holding: reading.holding,
      buyerHolds: reading.buyerHolds,
      recipient: intent.recipient,
    },
    policy,
  ).map(({ rule, detail }): GuardRefusal => ({ rule, detail, source: 'policy' })),
  ...boundBreaches(intent.amount, reading.state, nowSeconds),
];

const record = (
  file: string,
  intent: Intent,
  refusals: GuardRefusal[],
  reading: Reading | null,
): Decision => {
  const decision: Decision = {
    at: new Date().toISOString(),
    decidedBy: 'app',
    verdict: reading === null ? 'declined' : refusals.length === 0 ? 'proceed' : 'refused',
    refusals,
    action: intent.action,
    amount: String(intent.amount),
    pricePerToken: String(intent.pricePerToken),
    recipient: intent.recipient,
    rationale: intent.rationale,
    holding: reading === null ? null : String(reading.holding),
    buyerHolds: reading === null ? null : String(reading.buyerHolds),
    state: reading?.state ?? null,
  };
  appendRecord(file, decision);
  return decision;
};

export interface GuardRun {
  reads?: GuardReads;
  policy?: Policy;
  file?: string;
  nowSeconds?: number;
}

/** No model runs in here, and the registry is read again for every decision. */
export async function guardIntent(intent: Intent, run: GuardRun = {}): Promise<Decision> {
  const {
    reads = CHAIN,
    policy = POLICY,
    file = GUARD_FILE,
    nowSeconds = Math.floor(Date.now() / 1000),
  } = run;
  if (intent.action === 'decline') return record(file, intent, [], null);

  const state = await reads.state();
  const atBlock = BigInt(state.blockNumber);
  const reading: Reading = {
    holding: await reads.balance(state.principal, atBlock),
    buyerHolds: await reads.balance(intent.recipient, atBlock),
    state,
  };
  return record(file, intent, judge(intent, reading, policy, nowSeconds), reading);
}
