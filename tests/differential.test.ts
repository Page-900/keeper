import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ANCHORED_CLAUSES,
  BATTERY_FILE,
  provedClauses,
  recordCase,
  type BatteryCase,
  type BatteryClaim,
} from '../src/chain/battery.js';
import { CLAUSES, agreeWithChain, evaluate, type Clause } from '../src/chain/differential.js';
import { NO_MANDATE_PRINCIPAL } from '../src/shared/config.js';
import type { RegistryRead } from '../src/chain/registry.js';
import { SUNL_DECIMALS, UNCAPPED, requireAddress } from '../src/shared/config.js';
import { readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';
import { PER_TRANSACTION, STATE_TIME, registryState } from './support/registry-state.js';

const sunl = (whole: bigint): bigint => whole * 10n ** BigInt(SUNL_DECIMALS);

const ASSET = requireAddress('asset');
const OTHER = `0x${'ab'.repeat(20)}` as const;
const ZERO = '0x0000000000000000000000000000000000000000' as const;

const at = (state: Partial<RegistryRead>, amount = PER_TRANSACTION) =>
  evaluate(registryState(state), amount, ASSET);

interface Case {
  name: string;
  state: Partial<RegistryRead>;
  amount: bigint;
  firstFalse: Clause | null;
}

const CASES: Case[] = [
  { name: 'everything holds', state: {}, amount: PER_TRANSACTION, firstFalse: null },
  {
    name: 'a different token, which the contract checks before anything else',
    state: { mandateAsset: OTHER },
    amount: PER_TRANSACTION,
    firstFalse: 'asset',
  },
  {
    name: 'no mandate at all, which the contract reads off the principal and not the window',
    state: { mandatePrincipal: ZERO },
    amount: PER_TRANSACTION,
    firstFalse: 'no mandate',
  },
  {
    name: 'a window that has not opened',
    state: { mandateValidFrom: String(STATE_TIME + 1n) },
    amount: PER_TRANSACTION,
    firstFalse: 'window',
  },
  {
    name: 'a window that closed one second ago',
    state: { mandateValidUntil: String(STATE_TIME - 1n) },
    amount: PER_TRANSACTION,
    firstFalse: 'window',
  },
  {
    name: 'a revoked mandate',
    state: { mandateRevoked: true },
    amount: PER_TRANSACTION,
    firstFalse: 'revoked',
  },
  {
    name: 'an action that is not enabled',
    state: { actionEnabled: false },
    amount: PER_TRANSACTION,
    firstFalse: 'action',
  },
  {
    name: 'a frozen agent',
    state: { agentFrozen: true },
    amount: PER_TRANSACTION,
    firstFalse: 'frozen',
  },
  {
    name: 'one unit over the per transaction cap',
    state: {},
    amount: PER_TRANSACTION + 1n,
    firstFalse: 'per transaction cap',
  },
  {
    name: 'an amount that crosses the lifetime cap',
    state: { cumulativeUsed: String(sunl(900n)) },
    amount: PER_TRANSACTION,
    firstFalse: 'cumulative cap',
  },
];

describe('the reader evaluates each clause the registry folds into one boolean', () => {
  it.each(CASES)('$name', ({ state, amount, firstFalse }) => {
    const evaluation = at(state, amount);

    expect(evaluation.firstFalse).toBe(firstFalse);
    expect(evaluation.allowed).toBe(firstFalse === null);
  });

  it('reads every clause the contract has, in the order the contract checks them', () => {
    expect(at({}).clauses.map((result) => result.clause)).toEqual([...CLAUSES]);
  });

  it('names the FIRST false clause, because that is the only one the chain acted on', () => {
    const evaluation = at({ mandateRevoked: true, agentFrozen: true, mandateAsset: OTHER });

    expect(evaluation.firstFalse).toBe('asset');
  });

  it('still runs on the last second of the window, which the contract allows', () => {
    expect(at({ mandateValidUntil: String(STATE_TIME) }).allowed).toBe(true);
  });

  it('treats an uncapped limit as no limit, the way the contract does', () => {
    const evaluation = at({ maxTransactionValue: String(UNCAPPED) }, sunl(1_000_000n));

    expect(
      evaluation.clauses.find((result) => result.clause === 'per transaction cap')?.passed,
    ).toBe(true);
  });
});

describe('the chain is the authority and a disagreeing reader says so', () => {
  it('passes when the reader and canExecute agree', () => {
    expect(agreeWithChain(at({}), true).allowed).toBe(true);
  });

  it('refuses when the reader says yes and the chain says no', async () => {
    const error = await captureError(() => Promise.resolve(agreeWithChain(at({}), false)));

    expect(error.kind).toBe('refusalUnattributable');
  });

  it('refuses when the reader says no and the chain says yes', async () => {
    const error = await captureError(() =>
      Promise.resolve(agreeWithChain(at({ mandateRevoked: true }), true)),
    );

    expect(error.kind).toBe('refusalUnattributable');
  });
});

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-battery-'));
  file = join(directory, 'battery.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const CALL_FAILED = { error: 'CallFailed', args: [] };

const claim = (over: Partial<BatteryClaim> = {}): BatteryClaim => ({
  case: 'C1',
  layer: 'mandate',
  blockNumber: '11592921',
  transactionHash: null,
  revert: { error: 'CannotExecute', args: [] },
  firstFalse: 'per transaction cap',
  clauses: at({}).clauses,
  agreedWithChain: true,
  state: registryState(),
  ...over,
});

describe('an unattributed block is not reportable, so the record refuses one', () => {
  it('writes a case that names its layer and its clause', () => {
    recordCase(file, claim());

    expect(readRecords<{ case: string }>(file)).toHaveLength(1);
  });

  it('refuses a mandate layer case that names no clause', async () => {
    const error = await captureError(() =>
      Promise.resolve(recordCase(file, claim({ firstFalse: null }))),
    );

    expect(error.kind).toBe('refusalUnattributable');
    expect(readRecords(file)).toHaveLength(0);
  });

  it('refuses to credit the token when the mandate refused it first', async () => {
    const error = await captureError(() =>
      Promise.resolve(recordCase(file, claim({ layer: 'token' }))),
    );

    expect(error.kind).toBe('refusalUnattributable');
  });

  it('accepts a token layer case, which the mandate allowed and the token stopped', () => {
    recordCase(file, claim({ case: 'W1', layer: 'token', firstFalse: null, revert: CALL_FAILED }));

    expect(readRecords<{ layer: string }>(file)[0]?.layer).toBe('token');
  });

  it('refuses a token layer case that reverted with the error the mandate raises', async () => {
    const error = await captureError(() =>
      Promise.resolve(recordCase(file, claim({ case: 'W1', layer: 'token', firstFalse: null }))),
    );

    expect(error.kind).toBe('refusalUnattributable');
  });

  it('refuses a mandate layer case that reverted with the error the target raises', async () => {
    const error = await captureError(() =>
      Promise.resolve(recordCase(file, claim({ revert: CALL_FAILED }))),
    );

    expect(error.kind).toBe('refusalUnattributable');
  });

  it('refuses a case our reader and the chain disagreed about', async () => {
    const error = await captureError(() =>
      Promise.resolve(recordCase(file, claim({ agreedWithChain: false }))),
    );

    expect(error.kind).toBe('refusalUnattributable');
  });

  it('keeps its real evidence file inside the evidence directory', () => {
    expect(BATTERY_FILE).toMatch(/evidence[\\/]battery\.jsonl$/);
  });
});

describe('the clauses this project claims to have anchored are the ones it can show', () => {
  it('lists only clauses the contract actually has', () => {
    expect(CLAUSES).toEqual(expect.arrayContaining([...ANCHORED_CLAUSES]));
  });

  it('leaves out the two no transaction of ours has ever reached', () => {
    expect(ANCHORED_CLAUSES).not.toContain('frozen');
    expect(ANCHORED_CLAUSES).not.toContain('no mandate');
  });

  it('reports the clauses in the order the contract tests them, not the order they were run', () => {
    const records = [
      { ...claim({ firstFalse: 'cumulative cap' }), at: '', chainId: 0 },
      { ...claim({ firstFalse: 'asset' }), at: '', chainId: 0 },
    ] as BatteryCase[];

    expect(provedClauses(records)).toEqual(['asset', 'cumulative cap']);
  });
});

describe('one clause the contract lists can never be the one that decides', () => {
  it('reads an absent mandate as the wrong asset, because that is tested first', () => {
    const absent = registryState({
      mandatePrincipal: NO_MANDATE_PRINCIPAL,
      mandateAsset: NO_MANDATE_PRINCIPAL,
      mandateGranted: false,
    });

    expect(evaluate(absent, 1n).firstFalse).toBe('asset');
  });

  it('reaches it only when the asset asked about is the absent one', () => {
    const absent = registryState({
      mandatePrincipal: NO_MANDATE_PRINCIPAL,
      mandateAsset: NO_MANDATE_PRINCIPAL,
      mandateGranted: false,
    });

    expect(evaluate(absent, 1n, NO_MANDATE_PRINCIPAL).firstFalse).toBe('no mandate');
  });
});
