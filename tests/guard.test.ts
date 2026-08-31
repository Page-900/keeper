import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CLAUSES, evaluate } from '../src/chain/differential.js';
import type { RegistryRead } from '../src/chain/registry.js';
import {
  GUARD_FILE,
  guardIntent,
  type Decision,
  type GuardReads,
  type RefusalSource,
  type Verdict,
} from '../src/keeper/guard.js';
import { readIntent } from '../src/keeper/intent.js';
import { NO_MANDATE_PRINCIPAL, SUNL_DECIMALS, requireAddress } from '../src/shared/config.js';
import { readRecords } from '../src/shared/jsonl.js';
import { STATE_BLOCK, registryState } from './support/registry-state.js';

const sunl = (whole: bigint): bigint => whole * 10n ** BigInt(SUNL_DECIMALS);

const PRINCIPAL = requireAddress('principal');
const COUNTERPARTY = requireAddress('counterparty');
const ASSET = requireAddress('asset');
const ESCROW = `0x${'ab'.repeat(20)}` as const;
const NOW = 1_790_000_000;

const proposal = (over: Record<string, unknown> = {}): unknown => ({
  action: 'deliver',
  amountWholeTokens: '250',
  pricePerToken: '47',
  recipient: COUNTERPARTY,
  rationale: 'the bid clears the floor and the occupancy note argues for a small size',
  ...over,
});

const HOLDINGS: Record<string, bigint> = {
  [PRINCIPAL.toLowerCase()]: sunl(1_750n),
  [COUNTERPARTY.toLowerCase()]: sunl(250n),
};

interface Asked {
  holder: `0x${string}`;
  atBlock: bigint;
}

interface Fake {
  reads: GuardReads;
  states: number;
  asked: Asked[];
}

const fakeReads = (
  state: RegistryRead = registryState(),
  balances: Record<string, bigint> = {},
): Fake => {
  const held = { ...HOLDINGS, ...balances };
  const fake: Fake = {
    states: 0,
    asked: [],
    reads: {
      state: (): Promise<RegistryRead> => {
        fake.states += 1;
        return Promise.resolve(state);
      },
      balance: (holder: `0x${string}`, atBlock: bigint): Promise<bigint> => {
        fake.asked.push({ holder, atBlock });
        return Promise.resolve(held[holder.toLowerCase()] ?? 0n);
      },
    },
  };
  return fake;
};

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-guard-'));
  file = join(directory, 'guard-decisions.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

interface Case {
  name: string;
  proposed: Record<string, unknown>;
  state: Partial<RegistryRead>;
  balances: Record<string, bigint>;
  verdict: Verdict;
  rules: string[];
  sources: RefusalSource[];
}

const guarded = (over: Partial<Case> = {}): Promise<Decision> => {
  const { reads } = fakeReads(registryState(over.state ?? {}), over.balances ?? {});
  return guardIntent(readIntent(proposal(over.proposed ?? {})), { reads, file, nowSeconds: NOW });
};

const CASES: Case[] = [
  {
    name: 'the delivery the standing bid actually asks for',
    proposed: {},
    state: {},
    balances: {},
    verdict: 'proceed',
    rules: [],
    sources: [],
  },
  {
    name: 'a price under the floor, which the chain would happily allow',
    proposed: { pricePerToken: '40' },
    state: {},
    balances: {},
    verdict: 'refused',
    rules: ['price floor'],
    sources: ['policy'],
  },
  {
    name: 'an address the holder never named, which the mandate does not police',
    proposed: { recipient: ESCROW },
    state: {},
    balances: {},
    verdict: 'refused',
    rules: ['settlement address'],
    sources: ['policy'],
  },
  {
    name: 'a buyer left holding more than the policy allows',
    proposed: {},
    state: {},
    balances: { [COUNTERPARTY.toLowerCase()]: sunl(400n) },
    verdict: 'refused',
    rules: ['counterparty concentration'],
    sources: ['policy'],
  },
  {
    name: 'a delivery that would take the holding under its floor',
    proposed: {},
    state: {},
    balances: { [PRINCIPAL.toLowerCase()]: sunl(1_400n) },
    verdict: 'refused',
    rules: ['holding floor'],
    sources: ['policy'],
  },
  {
    name: 'one token more than the mandate moves at once',
    proposed: { amountWholeTokens: '251' },
    state: {},
    balances: { [COUNTERPARTY.toLowerCase()]: 0n },
    verdict: 'refused',
    rules: ['per transaction cap'],
    sources: ['mandate bound'],
  },
  {
    name: 'an amount that would cross the lifetime cap',
    proposed: {},
    state: { cumulativeUsed: String(sunl(800n)) },
    balances: {},
    verdict: 'refused',
    rules: ['cumulative cap'],
    sources: ['mandate bound'],
  },
  {
    name: 'a mandate the principal has revoked',
    proposed: {},
    state: { mandateRevoked: true },
    balances: {},
    verdict: 'refused',
    rules: ['revoked'],
    sources: ['mandate bound'],
  },
  {
    name: 'an agent the registry has frozen',
    proposed: {},
    state: { agentFrozen: true },
    balances: {},
    verdict: 'refused',
    rules: ['frozen'],
    sources: ['mandate bound'],
  },
  {
    name: 'no mandate at all, which the registry reports as a zero principal',
    proposed: {},
    state: { mandateGranted: false, mandatePrincipal: NO_MANDATE_PRINCIPAL },
    balances: {},
    verdict: 'refused',
    rules: ['no mandate'],
    sources: ['mandate bound'],
  },
  {
    name: 'an action the mandate does not enable',
    proposed: {},
    state: { actionEnabled: false },
    balances: {},
    verdict: 'refused',
    rules: ['action'],
    sources: ['mandate bound'],
  },
  {
    name: 'a principal the compliance provider no longer clears',
    proposed: {},
    state: { principalEligible: false, eligibilityReason: 3 },
    balances: {},
    verdict: 'refused',
    rules: ['eligibility'],
    sources: ['compliance'],
  },
  {
    name: 'a mandate written over a different token',
    proposed: {},
    state: { mandateAsset: ESCROW },
    balances: {},
    verdict: 'refused',
    rules: ['asset'],
    sources: ['mandate bound'],
  },
  {
    name: 'a window that has not opened yet',
    proposed: {},
    state: { mandateValidFrom: String(NOW + 60) },
    balances: {},
    verdict: 'refused',
    rules: ['window'],
    sources: ['mandate bound'],
  },
  {
    name: 'a window that has already closed',
    proposed: {},
    state: { mandateValidUntil: String(NOW - 60) },
    balances: {},
    verdict: 'refused',
    rules: ['window'],
    sources: ['mandate bound'],
  },
  {
    name: 'a window open to its very last second, which the registry still allows',
    proposed: {},
    state: { mandateValidUntil: String(NOW) },
    balances: {},
    verdict: 'proceed',
    rules: [],
    sources: [],
  },
];

describe('the guard answers every intent from what it read, and names each rule', () => {
  it.each(CASES)('$name', async (given) => {
    const decision = await guarded(given);

    expect(decision.verdict).toBe(given.verdict);
    expect(decision.refusals.map((refusal) => refusal.rule)).toEqual(given.rules);
    expect([...new Set(decision.refusals.map((refusal) => refusal.source))]).toEqual(given.sources);
  });

  it('reports every rule one intent breaks, never only the first', async () => {
    const decision = await guarded({ proposed: { amountWholeTokens: '600' } });

    expect(decision.refusals.map((refusal) => refusal.rule)).toEqual([
      'counterparty concentration',
      'holding floor',
      'per transaction cap',
    ]);
  });

  it('says why in plain words, so a refusal reads to someone who does not code', async () => {
    const decision = await guarded({ proposed: { pricePerToken: '40' } });

    expect(decision.refusals[0]?.detail).toBe('40 per token is below 45');
  });
});

describe('the guard reads the registry again inside every decision', () => {
  it('never answers a second intent from the state it read for the first', async () => {
    const run = fakeReads();

    await guardIntent(readIntent(proposal()), { reads: run.reads, file, nowSeconds: NOW });
    await guardIntent(readIntent(proposal()), { reads: run.reads, file, nowSeconds: NOW });

    expect(run.states).toBe(2);
  });

  it('reads both balances at the block the registry answered at', async () => {
    const run = fakeReads();

    await guardIntent(readIntent(proposal()), { reads: run.reads, file, nowSeconds: NOW });

    expect(run.asked).toEqual([
      { holder: PRINCIPAL, atBlock: STATE_BLOCK },
      { holder: COUNTERPARTY, atBlock: STATE_BLOCK },
    ]);
  });

  it('carries the state it judged on into the record, so a reader can check it', async () => {
    const decision = await guarded();

    expect(decision.state?.blockNumber).toBe(String(STATE_BLOCK));
    expect(decision.holding).toBe(String(sunl(1_750n)));
    expect(decision.buyerHolds).toBe(String(sunl(250n)));
  });
});

describe('a decline moves nothing, so nothing is read and nothing is refused', () => {
  it('records the decline and asks the chain nothing at all', async () => {
    const run = fakeReads();
    const intent = readIntent(
      proposal({ action: 'decline', amountWholeTokens: '0', recipient: '' }),
    );

    const decision = await guardIntent(intent, { reads: run.reads, file, nowSeconds: NOW });

    expect(decision.verdict).toBe('declined');
    expect(run.states).toBe(0);
    expect(decision.state).toBeNull();
  });
});

describe('the guard and the differential reader answer with one voice', () => {
  const BROKEN: Partial<RegistryRead> = {
    mandateRevoked: true,
    actionEnabled: false,
    cumulativeUsed: String(sunl(900n)),
  };

  it('names exactly the clauses the reader found false, in the order the contract tests them', async () => {
    const decision = await guarded({ state: BROKEN, proposed: { amountWholeTokens: '251' } });

    const reader = evaluate(registryState(BROKEN), sunl(251n), ASSET, BigInt(NOW));

    expect(
      decision.refusals.filter((refusal) => refusal.source === 'mandate bound').map((r) => r.rule),
    ).toEqual(reader.clauses.filter((clause) => !clause.passed).map((clause) => clause.clause));
  });

  it('signs nothing as a mandate bound that is not one of the registry own clauses', async () => {
    const decision = await guarded({
      state: { ...BROKEN, principalEligible: false, eligibilityReason: 3 },
    });

    const named = decision.refusals
      .filter((refusal) => refusal.source === 'mandate bound')
      .map((refusal) => refusal.rule);

    expect(named.filter((rule) => !(CLAUSES as readonly string[]).includes(rule))).toEqual([]);
    expect(named).not.toContain('eligibility');
  });

  it('calls the compliance provider answer what it is, because it gates a grant and not an action', async () => {
    const decision = await guarded({ state: { principalEligible: false, eligibilityReason: 3 } });

    expect(decision.refusals.map((refusal) => refusal.source)).toEqual(['compliance']);
  });
});

describe('the guard is the app layer and never claims to be anything else', () => {
  it('signs every decision as the app layer, refusals on chain bounds included', async () => {
    const decision = await guarded({ state: { mandateRevoked: true } });

    expect(decision.decidedBy).toBe('app');
  });

  it('writes each decision to the evidence file it was given', async () => {
    await guarded({ proposed: { recipient: ESCROW } });

    const written = readRecords<Decision>(file);

    expect(written).toHaveLength(1);
    expect(written[0]?.refusals[0]?.rule).toBe('settlement address');
  });

  it('keeps its real evidence file inside the evidence directory', () => {
    expect(GUARD_FILE).toMatch(/evidence[\\/]guard-decisions\.jsonl$/);
  });

  it('has no model in it, which is the whole reason it is trusted to decide', () => {
    const source = readFileSync(new URL('../src/keeper/guard.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/model\.js|Anthropic|askModel/);
  });
});
