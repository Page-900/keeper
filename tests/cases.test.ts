import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BatteryCase } from '../src/chain/battery.js';
import { recordAnchor } from '../src/chain/anchors.js';
import {
  BEFORE_THE_CAP_IS_SPENT,
  alreadyRun,
  calldataFor,
  cycleOne,
  legalAlreadySent,
  legalAnchor,
  legalRuns,
  runCase,
  runLegal,
  type CaseChain,
  type CaseSpec,
} from '../src/chain/cases.js';
import type { RegistryRead } from '../src/chain/registry.js';
import type { RevertReason } from '../src/chain/client.js';
import {
  PROBE_MANDATE,
  SECOND_ACTION_ID,
  TRANSFER_ACTION,
  requireAddress,
} from '../src/shared/config.js';
import { readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';
import { STATE_TIME, registryState } from './support/registry-state.js';

const CAP = PROBE_MANDATE.maxTransactionValue;

const HASH: `0x${string}` = `0x${'cd'.repeat(32)}`;

const probeState = (over: Partial<RegistryRead> = {}): RegistryRead =>
  registryState({
    agent: requireAddress('probe'),
    mandateAgent: requireAddress('probe'),
    maxTransactionValue: String(CAP),
    maxCumulativeValue: String(PROBE_MANDATE.maxCumulativeValue),
    cumulativeUsed: '0',
    ...over,
  });

interface Recorded {
  sent: CaseSpec[];
  simulated: CaseSpec[];
}

const CANNOT_EXECUTE: RevertReason = { error: 'CannotExecute', args: [] };

const CALL_FAILED: RevertReason = { error: 'CallFailed', args: [] };

const fakeChain = (
  state: RegistryRead,
  over: Partial<CaseChain> = {},
  revert: RevertReason = CANNOT_EXECUTE,
): { chain: CaseChain; seen: Recorded } => {
  const seen: Recorded = { sent: [], simulated: [] };
  const chain: CaseChain = {
    state: () => Promise.resolve(state),
    canExecute: () => Promise.resolve(false),
    simulate: (spec) => {
      seen.simulated.push(spec);
      return Promise.resolve(revert);
    },
    send: (spec) => {
      seen.sent.push(spec);
      return Promise.resolve(HASH);
    },
    confirm: () => Promise.resolve({ status: 'reverted', blockNumber: '11593000' }),
    ...over,
  };
  return { chain, seen };
};

let directory: string;
let file: string;
let anchors: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-cases-'));
  file = join(directory, 'battery.jsonl');
  anchors = join(directory, 'chain-anchors.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const C1: CaseSpec = {
  name: 'C1',
  layer: 'mandate',
  expect: 'per transaction cap',
  asset: 'asset',
  action: TRANSFER_ACTION,
  to: 'principal',
  amount: CAP + 1n,
};

describe('the sequence is the deliverable, and it is written down in order', () => {
  it('runs the window case before the caps, because the contract checks it first', () => {
    expect(cycleOne(PROBE_MANDATE).map((spec) => spec.name)).toEqual([
      'T1',
      'C1',
      'A1',
      'S1',
      'C2',
      'T2',
    ]);
  });

  it('gives every case the clause it is meant to prove, and no two share a purpose', () => {
    const clauses = cycleOne(PROBE_MANDATE).map((spec) => spec.expect);

    expect(clauses).toEqual([
      'window',
      'per transaction cap',
      'action',
      'asset',
      'cumulative cap',
      'window',
    ]);
  });

  it('finishes every case that needs an unspent budget before the one that spends it', () => {
    const order = cycleOne(PROBE_MANDATE).map((spec) => spec.name);
    const spendsTheCap = order.indexOf('C2');

    for (const name of BEFORE_THE_CAP_IS_SPENT)
      expect(order.indexOf(name)).toBeLessThan(spendsTheCap);
  });

  it('asks the executor for an action it forwards but no mandate enables', () => {
    const a1 = cycleOne(PROBE_MANDATE).find((spec) => spec.name === 'A1');

    expect(a1?.action).toBe(SECOND_ACTION_ID);
    expect(calldataFor(a1 as CaseSpec).startsWith('0x095ea7b3')).toBe(true);
  });

  it('plans the legal runs needed to reach the lifetime cap, and no more', () => {
    const runs = legalRuns(PROBE_MANDATE);
    const total = runs.reduce((sum, spec) => sum + spec.amount, 0n);

    expect(runs).toHaveLength(2);
    expect(total).toBe(PROBE_MANDATE.maxCumulativeValue);
  });

  it('sends the legal runs back to the investor, so no balance anywhere else moves', () => {
    for (const spec of legalRuns(PROBE_MANDATE)) expect(spec.to).toBe('principal');
  });

  it('never sends the probe transfers anywhere but back to the investor', () => {
    for (const spec of cycleOne(PROBE_MANDATE)) expect(spec.to).toBe('principal');
  });
});

describe('a legal run spends real budget, so it can never be sent a second time', () => {
  const legal = (): CaseSpec => legalRuns(PROBE_MANDATE)[0] as CaseSpec;

  const allowing = () =>
    fakeChain(probeState(), {
      canExecute: () => Promise.resolve(true),
      confirm: () => Promise.resolve({ status: 'success', blockNumber: '11593790' }),
    });

  it('sends it when the anchor file holds no successful send of it', async () => {
    const { chain, seen } = allowing();

    await runLegal(legal(), { chain, agent: 'probe', file, anchors });

    expect(seen.sent).toHaveLength(1);
  });

  it('refuses when one is already anchored, because a rerun would spend the budget twice', async () => {
    const { chain, seen } = allowing();
    recordAnchor(anchors, {
      action: legalAnchor('legal-1'),
      transactionHash: HASH,
      blockNumber: '11593790',
      status: 'success',
      contract: null,
      gasUsed: '114504',
    });

    const failure = await captureError(() =>
      runLegal(legal(), { chain, agent: 'probe', file, anchors }),
    );

    expect(failure.kind).toBe('alreadyCreated');
    expect(seen.sent).toHaveLength(0);
    expect(legalAlreadySent('legal-1', anchors)).toBe(true);
  });

  it('does not count a failed send, because a failure spent nothing', () => {
    recordAnchor(anchors, {
      action: legalAnchor('legal-1'),
      transactionHash: HASH,
      blockNumber: '11593790',
      status: 'reverted',
      contract: null,
      gasUsed: '21000',
    });

    expect(legalAlreadySent('legal-1', anchors)).toBe(false);
  });
});

describe('a case proves itself by free reads before it costs any gas', () => {
  it('records the case with its clause once the chain has reverted it', async () => {
    const { chain } = fakeChain(probeState());

    const record = await runCase(C1, { chain, agent: 'probe', file });

    expect(record.firstFalse).toBe('per transaction cap');
    expect(readRecords<BatteryCase>(file)).toHaveLength(1);
  });

  it('sends nothing when the clause it would prove is not the clause that fails', async () => {
    const { chain, seen } = fakeChain(probeState({ mandateRevoked: true }));

    const error = await captureError(() => runCase(C1, { chain, agent: 'probe', file }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(seen.sent).toEqual([]);
  });

  it('sends nothing when our reading and the registry disagree', async () => {
    const { chain, seen } = fakeChain(probeState(), { canExecute: () => Promise.resolve(true) });

    const error = await captureError(() => runCase(C1, { chain, agent: 'probe', file }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(seen.sent).toEqual([]);
  });

  it('sends nothing when the simulation disagrees with the reading', async () => {
    const { chain, seen } = fakeChain(probeState(), { simulate: () => Promise.resolve(null) });

    const error = await captureError(() => runCase(C1, { chain, agent: 'probe', file }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(seen.sent).toEqual([]);
  });

  it('simulates before it sends, every time', async () => {
    const { chain, seen } = fakeChain(probeState());

    await runCase(C1, { chain, agent: 'probe', file });

    expect(seen.simulated).toHaveLength(1);
    expect(seen.sent).toHaveLength(1);
  });

  it('refuses when a case meant to revert succeeded on the chain instead', async () => {
    const { chain } = fakeChain(probeState(), {
      confirm: () => Promise.resolve({ status: 'success', blockNumber: '11593000' }),
    });

    const error = await captureError(() => runCase(C1, { chain, agent: 'probe', file }));

    expect(error.kind).toBe('writeUnconfirmed');
  });

  it('refuses to run a case twice, so a rerun cannot invent a second anchor', async () => {
    const { chain } = fakeChain(probeState());
    await runCase(C1, { chain, agent: 'probe', file });

    const error = await captureError(() => runCase(C1, { chain, agent: 'probe', file }));

    expect(error.kind).toBe('alreadyCreated');
    expect(alreadyRun('C1', file)).toBe(true);
  });
});

describe('the window cases are judged on the block clock and not on ours', () => {
  it('attributes a run before the window opens to the window and not to a cap', async () => {
    const early = probeState({ mandateValidFrom: String(STATE_TIME + 60n) });
    const { chain } = fakeChain(early);
    const t1 = cycleOne(PROBE_MANDATE)[0] as CaseSpec;

    const record = await runCase(t1, { chain, agent: 'probe', file });

    expect(record.firstFalse).toBe('window');
  });
});

describe('every case in the battery is a refusal, and the mandate has to be the one refusing', () => {
  it('sends nothing when the mandate allows the case the runner was given', async () => {
    const { chain, seen } = fakeChain(registryState(), { canExecute: () => Promise.resolve(true) });
    const allowed: CaseSpec = { ...C1, expect: null, amount: 1n };

    const error = await captureError(() => runCase(allowed, { chain, agent: 'agent', file }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(seen.sent).toEqual([]);
  });

  it('sends nothing when the revert is not the one the layer it claims produces', async () => {
    const { chain, seen } = fakeChain(probeState(), {}, CALL_FAILED);

    const error = await captureError(() => runCase(C1, { chain, agent: 'probe', file }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(seen.sent).toEqual([]);
  });
});
