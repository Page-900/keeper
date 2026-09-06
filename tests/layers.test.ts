import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toFunctionSelector } from 'viem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EXECUTOR_ARTIFACT, compiledArtifact } from '../src/chain/artifacts.js';
import { guardIntent, type Decision, type GuardReads } from '../src/keeper/guard.js';
import type { DeliverIntent } from '../src/keeper/intent.js';
import { POLICY, type Policy } from '../src/keeper/policy.js';
import { LAYERS_FILE, differential, layers, type LabRow } from '../src/layers.js';
import { PRINCIPAL_HOLDING, requireAddress } from '../src/shared/config.js';
import { captureError } from './support/capture-error.js';
import { STATE_TIME, registryState } from './support/registry-state.js';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-layers-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const write = (name: string, records: readonly object[]): string => {
  const file = join(directory, name);
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join('\n'), 'utf8');
  return file;
};

const labRow = (fields: Partial<LabRow> = {}): LabRow => ({
  venue: 'lab',
  configuration: 'guard off, amount inside every cap',
  put: '250000000000000000000',
  refusedBy: 'nothing',
  revertName: '',
  revertSelector: '0x00000000',
  moved: '250000000000000000000',
  cumulativeUsed: '250000000000000000000',
  maxTransactionValue: '250000000000000000000',
  maxCumulativeValue: '1000000000000000000000',
  decimals: '18',
  ...fields,
});

const measured = (): ReturnType<typeof differential> => differential();

describe('the four configurations are read from what was measured, never from memory', () => {
  it('holds a table that is in step with the evidence behind it', () => {
    expect(readFileSync(LAYERS_FILE, 'utf8')).toBe(layers());
  });

  it('names one configuration that nothing refused, and states what moved in it', () => {
    const open = measured().lab.filter((row) => row.refusedBy === 'nothing');

    expect(open.length).toBeGreaterThan(0);
    for (const row of open) expect(BigInt(row.moved)).toBeGreaterThan(0n);
    expect(layers()).toContain('The mandate bounds how much, never to whom.');
  });

  it('credits the one refusal on the chain to the error the compiled executor declares', () => {
    const refused = measured().lab.filter((row) => row.refusedBy === 'mandate');
    const { abi } = compiledArtifact(EXECUTOR_ARTIFACT);

    expect(refused.length).toBeGreaterThan(0);
    for (const row of refused) {
      const declared = abi.find(
        (item): item is { type: 'error'; name: string; inputs: { type: string }[] } =>
          (item as { type?: string }).type === 'error' &&
          (item as { name?: string }).name === row.revertName,
      );
      const inputs = declared?.inputs.map((input) => input.type).join(',') ?? '';
      expect(toFunctionSelector(`${row.revertName}(${inputs})`)).toBe(row.revertSelector);
    }
  });

  it('refuses a run that measured nothing, so a deleted file cannot pass as a clean one', async () => {
    const error = await captureError(() =>
      Promise.resolve().then(() => differential({ lab: write('empty.jsonl', []) })),
    );

    expect(error.kind).toBe('refusalUnattributable');
  });

  it('refuses a lab result filed against the deployment everyone else shares', async () => {
    const error = await captureError(() =>
      Promise.resolve().then(() =>
        differential({ lab: write('mixed.jsonl', [labRow({ venue: 'registry' })]) }),
      ),
    );

    expect(error.kind).toBe('refusalUnattributable');
  });

  it('refuses to build the table from a run the guard did not refuse', async () => {
    const compromised = { ...measured().app };
    const error = await captureError(() =>
      Promise.resolve().then(() =>
        differential({
          jailbreak: write('passed.jsonl', [
            {
              at: compromised.at,
              model: compromised.model,
              payload: compromised.payload,
              compromised: true,
              guardVerdict: 'proceed',
              guardRefusals: [],
              intent: { action: 'deliver', amount: compromised.amount, recipient: '0x00' },
            },
          ]),
        }),
      ),
    );

    expect(error.kind).toBe('refusalUnattributable');
  });
});

const reads: GuardReads = {
  state: () => Promise.resolve(registryState()),
  balance: (holder) =>
    Promise.resolve(
      holder.toLowerCase() === requireAddress('principal').toLowerCase() ? PRINCIPAL_HOLDING : 0n,
    ),
};

const recorded = (): DeliverIntent => {
  const { amount, recipient } = measured().app;
  return {
    action: 'deliver',
    amount: BigInt(amount),
    pricePerToken: POLICY.minimumPricePerToken,
    recipient: recipient as `0x${string}`,
    rationale: 'the proposal the recorded run was talked into',
  };
};

const judged = (policy: Policy): Promise<Decision> =>
  guardIntent(recorded(), {
    reads,
    policy,
    file: join(directory, 'guard.jsonl'),
    nowSeconds: Number(STATE_TIME),
  });

describe('the first row is what the guard says today, not what the file remembers', () => {
  it('still refuses the recorded proposal, and refuses it on the settlement address alone', async () => {
    const decision = await judged(POLICY);

    expect(decision.verdict).toBe('refused');
    expect(decision.refusals.map((refusal) => refusal.rule)).toEqual(['settlement address']);
    expect(decision.refusals.map((refusal) => refusal.source)).toEqual(['policy']);
  });

  it('is let through the moment that one rule stops naming the destination', async () => {
    const decision = await judged({ ...POLICY, settlesTo: ['counterparty', 'uncleared'] });

    expect(decision.verdict).toBe('proceed');
    expect(decision.refusals).toEqual([]);
  });
});
