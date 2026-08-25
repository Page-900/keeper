import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Artifact } from '../src/chain/client.js';
import {
  MANDATE_FIELDS,
  readRegistryState,
  type RegistryChain,
  type RegistryRead,
} from '../src/chain/registry.js';
import {
  CHAIN_ID,
  MANDATE_ACTIONS,
  RECORDER_ROLE,
  identityRef,
  requireAddress,
} from '../src/shared/config.js';
import { readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';

const address = (tail: string): `0x${string}` => `0x${tail.padStart(40, '0')}`;

const ARTIFACT: Artifact = { abi: [], bytecode: '0x' };

const PRINCIPAL = requireAddress('principal');
const AGENT = requireAddress('agent');
const BLOCK = 11_514_300n;

type Mandate = Record<string, unknown>;

const ungranted = (overrides: Mandate = {}): Mandate => ({
  agent: address('0'),
  validFrom: 0,
  validUntil: 0,
  principal: address('0'),
  revoked: false,
  complianceProvider: address('0'),
  identityRef: '0x00',
  asset: address('0'),
  maxTransactionValue: 0n,
  maxCumulativeValue: 0n,
  cumulativeUsed: 0n,
  metadata: '0x00',
  ...overrides,
});

const without = (field: string): Mandate =>
  Object.fromEntries(Object.entries(ungranted()).filter(([name]) => name !== field));

interface Asked {
  functionName: string;
  args: readonly unknown[];
  atBlock: bigint;
}

const fakeChain = (
  overrides: { values?: Record<string, unknown>; owner?: `0x${string}` } = {},
): { asked: Asked[]; chain: RegistryChain } => {
  const asked: Asked[] = [];
  const values: Record<string, unknown> = {
    getMandate: ungranted(),
    isFrozen: false,
    nonces: 0n,
    checkPrincipal: [true, 0, 0],
    hasRole: true,
    isActionEnabled: true,
    ...overrides.values,
  };
  return {
    asked,
    chain: {
      block: () => Promise.resolve(BLOCK),
      read: (_contract, _artifact, functionName, args, atBlock) => {
        asked.push({ functionName, args, atBlock });
        return Promise.resolve(values[functionName]);
      },
      readAddress: () => Promise.resolve(overrides.owner ?? PRINCIPAL),
    },
  };
};

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-reads-'));
  file = join(directory, 'registry-reads.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const captured = (): RegistryRead[] => readRecords<RegistryRead>(file);

const read = (overrides: Parameters<typeof fakeChain>[0] = {}) => {
  const { asked, chain } = fakeChain(overrides);
  return {
    asked,
    run: (): Promise<RegistryRead> =>
      readRegistryState({
        chain,
        file,
        registry: ARTIFACT,
        executor: ARTIFACT,
        roles: ARTIFACT,
        compliance: ARTIFACT,
      }),
  };
};

describe('the registry is asked what it holds for this project, and the answer is captured', () => {
  it('records the state of both wallets against both contracts, at one block', async () => {
    const state = await read().run();

    expect(state).toEqual({
      at: expect.any(String) as string,
      chainId: CHAIN_ID,
      registry: requireAddress('agentMandate'),
      executor: requireAddress('executor'),
      principal: PRINCIPAL,
      agent: AGENT,
      blockNumber: '11514300',
      mandateGranted: false,
      mandateValidUntil: '0',
      mandateAgent: address('0'),
      mandateAsset: address('0'),
      mandateRevoked: false,
      maxTransactionValue: '0',
      maxCumulativeValue: '0',
      cumulativeUsed: '0',
      actionEnabled: true,
      agentFrozen: false,
      principalNonce: '0',
      principalEligible: true,
      eligibilityReason: 0,
      eligibilityExpiresAt: '0',
      executorMayRecord: true,
    });
    expect(captured()).toEqual([state]);
  });

  it('asks every question at the same block, so the record is a state and not a set of moments', async () => {
    const asking = read();

    await asking.run();

    const asked = asking.asked.map((question) => question.atBlock);

    expect(asked).toEqual(asked.map(() => BLOCK));
    expect(asked).toHaveLength(6);
  });

  it('asks about the agent and the principal in the order the registry expects', async () => {
    const asking = read();

    await asking.run();

    expect(asking.asked).toEqual([
      { functionName: 'getMandate', args: [AGENT, PRINCIPAL], atBlock: BLOCK },
      { functionName: 'isFrozen', args: [AGENT], atBlock: BLOCK },
      { functionName: 'nonces', args: [PRINCIPAL], atBlock: BLOCK },
      { functionName: 'checkPrincipal', args: [PRINCIPAL, identityRef], atBlock: BLOCK },
      {
        functionName: 'isActionEnabled',
        args: [AGENT, PRINCIPAL, MANDATE_ACTIONS[0]],
        atBlock: BLOCK,
      },
      {
        functionName: 'hasRole',
        args: [RECORDER_ROLE, requireAddress('executor')],
        atBlock: BLOCK,
      },
    ]);
  });

  it('reports a mandate once one is granted, which is what a non-zero expiry means', async () => {
    const granted = read({ values: { getMandate: ungranted({ validUntil: 1_800_000_000 }) } });

    expect((await granted.run()).mandateGranted).toBe(true);
  });

  it('captures when the granted mandate ends, because that date decides if the demo is live', async () => {
    const granted = read({ values: { getMandate: ungranted({ validUntil: 1_800_000_000 }) } });

    expect((await granted.run()).mandateValidUntil).toBe('1800000000');
  });
});

describe('the chain itself says which wallet controls the executor', () => {
  it('refuses to record anything when the deployed executor names another principal', async () => {
    const error = await captureError(read({ owner: address('bad') }).run);

    expect(error.kind).toBe('readBackMismatch');
    expect(error.detail).toContain(address('bad'));
    expect(captured()).toEqual([]);
  });
});

describe('a struct is only decoded when it is the struct the standard defines', () => {
  it('refuses a mandate missing a field, because every later read decodes this layout', async () => {
    const error = await captureError(read({ values: { getMandate: without('validUntil') } }).run);

    expect(error.kind).toBe('readBackMismatch');
    expect(error.detail).toContain('validUntil');
    expect(captured()).toEqual([]);
  });

  it('refuses an answer that is no struct at all', async () => {
    const error = await captureError(read({ values: { getMandate: null } }).run);

    expect(error.detail).toContain(MANDATE_FIELDS[0]);
  });

  it('refuses a freeze flag that is not true or false', async () => {
    const error = await captureError(read({ values: { isFrozen: 'no' } }).run);

    expect(error.kind).toBe('readBackMismatch');
    expect(error.detail).toContain('isFrozen()');
  });

  it('refuses a nonce that is not a whole number, rather than publishing it as one', async () => {
    const error = await captureError(read({ values: { nonces: 1.5 } }).run);

    expect(error.kind).toBe('readBackMismatch');
    expect(error.detail).toContain('nonces()');
  });

  it('refuses an eligibility answer that is not the three values the standard returns', async () => {
    const error = await captureError(read({ values: { checkPrincipal: [true, 0] } }).run);

    expect(error.kind).toBe('readBackMismatch');
    expect(error.detail).toContain('no eligibility');
  });

  it('refuses a role answer that is not true or false', async () => {
    const error = await captureError(read({ values: { hasRole: 'yes' } }).run);

    expect(error.kind).toBe('readBackMismatch');
    expect(error.detail).toContain('hasRole()');
  });
});

describe('the two prerequisites only Brickken can set are read from the chain, never assumed', () => {
  it('records an ineligible principal with the reason code, rather than refusing to look', async () => {
    const state = await read({ values: { checkPrincipal: [false, 6, 0] } }).run();

    expect(state.principalEligible).toBe(false);
    expect(state.eligibilityReason).toBe(6);
    expect(captured()).toEqual([state]);
  });

  it('records an executor that cannot record, which reads as a broken mandate if unseen', async () => {
    const state = await read({ values: { hasRole: false } }).run();

    expect(state.executorMayRecord).toBe(false);
  });

  it('derives the role name the registry gates recording on', () => {
    expect(RECORDER_ROLE).toBe(
      '0xf996da754c790e95d5c7ca3330cfcad529487fe9d1d8edb7afc65076fdf9adb4',
    );
  });
});
