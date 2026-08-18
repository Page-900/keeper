import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Anchor } from '../src/chain/anchors.js';
import type { ActionSpec, Artifact, Receipt, SignerRole } from '../src/chain/client.js';
import {
  deployExecutor,
  executorArtifact,
  registerAction,
  type ActionChain,
  type ExecutorChain,
} from '../src/chain/executor.js';
import { CHAIN_ID, PERMITTED_ACTION, requireAddress } from '../src/shared/config.js';
import { appendRecord, readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';

const address = (tail: string): `0x${string}` => `0x${tail.padStart(40, '0')}`;
const hash = (tail: string): `0x${string}` => `0x${tail.padStart(64, '0')}`;

const PRINCIPAL = address('9a11ce');
const AGENT = address('a6e17');
const EXECUTOR = address('e5');
const DEPLOY_HASH = hash('d1');

const ARTIFACT: Artifact = { abi: [], bytecode: '0x60806040' };

interface Sent {
  role: SignerRole;
  args: readonly unknown[];
}

const receipt = (overrides: Partial<Receipt> = {}): Receipt => ({
  status: 'success',
  blockNumber: 11_510_500n,
  contractAddress: EXECUTOR,
  ...overrides,
});

const fakeChain = (
  overrides: { receipt?: Receipt; reads?: Record<string, `0x${string}`> } = {},
): { sent: Sent[]; chain: ExecutorChain } => {
  const sent: Sent[] = [];
  return {
    sent,
    chain: {
      deploy: (role, _artifact, args) => {
        sent.push({ role, args });
        return Promise.resolve(DEPLOY_HASH);
      },
      receipt: () => Promise.resolve(overrides.receipt ?? receipt()),
      readAddress: (_contract, _artifact, functionName) =>
        Promise.resolve(overrides.reads?.[functionName] ?? PRINCIPAL),
      deployer: () => PRINCIPAL,
    },
  };
};

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-anchors-'));
  file = join(directory, 'chain-anchors.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const anchors = (): Anchor[] => readRecords<Anchor>(file);

const registryRead = { rams: requireAddress('agentMandate') };

describe('the executor is deployed once, from the principal wallet', () => {
  it('constructs it against the registry with the principal as both principal and owner', async () => {
    const { sent, chain } = fakeChain({ reads: registryRead });

    const deployment = await deployExecutor({ chain, file, artifact: ARTIFACT });

    expect(sent).toEqual([
      { role: 'principal', args: [requireAddress('agentMandate'), PRINCIPAL, PRINCIPAL] },
    ]);
    expect(deployment).toEqual({
      address: EXECUTOR,
      transactionHash: DEPLOY_HASH,
      blockNumber: '11510500',
    });
  });

  it('refuses a second deploy once the evidence log records the first', async () => {
    const { chain } = fakeChain({ reads: registryRead });
    await deployExecutor({ chain, file, artifact: ARTIFACT });

    const error = await captureError(() => deployExecutor({ chain, file, artifact: ARTIFACT }));

    expect(error.kind).toBe('alreadyDeployed');
    expect(anchors()).toHaveLength(1);
  });

  it('deploys again when the only recorded attempt reverted, because nothing was deployed', async () => {
    const reverted = fakeChain({ receipt: receipt({ status: 'reverted', contractAddress: null }) });
    await captureError(() => deployExecutor({ chain: reverted.chain, file, artifact: ARTIFACT }));

    const retry = fakeChain({ reads: registryRead });
    await deployExecutor({ chain: retry.chain, file, artifact: ARTIFACT });

    expect(retry.sent).toHaveLength(1);
    expect(anchors().map((anchor) => anchor.status)).toEqual(['reverted', 'success']);
  });
});

describe('what the chain reports is captured as it happens, whatever it says', () => {
  it('writes the hash, the block, the address, and the chain id into the evidence log', async () => {
    const { chain } = fakeChain({ reads: registryRead });

    await deployExecutor({ chain, file, artifact: ARTIFACT });

    expect(anchors()).toEqual([
      {
        at: expect.any(String) as string,
        action: 'deploy-executor',
        chainId: CHAIN_ID,
        transactionHash: DEPLOY_HASH,
        blockNumber: '11510500',
        status: 'success',
        contract: EXECUTOR,
      },
    ]);
  });

  it('records a reverted deploy before it refuses it, so the failure is evidence too', async () => {
    const { chain } = fakeChain({
      receipt: receipt({ status: 'reverted', contractAddress: null }),
    });

    const error = await captureError(() => deployExecutor({ chain, file, artifact: ARTIFACT }));

    expect(error.kind).toBe('writeUnconfirmed');
    expect(anchors()).toHaveLength(1);
    expect(anchors()[0]?.status).toBe('reverted');
  });
});

describe('a deployed address is trusted only after the chain reads its own state back', () => {
  it('refuses a contract whose registry is not the registry it was given', async () => {
    const { chain } = fakeChain({ reads: { rams: address('bad') } });

    const error = await captureError(() => deployExecutor({ chain, file, artifact: ARTIFACT }));

    expect(error.kind).toBe('readBackMismatch');
    expect(error.detail).toContain('rams()');
  });

  it('refuses a contract owned by anyone but the principal, because setAction is onlyOwner', async () => {
    const { chain } = fakeChain({ reads: { ...registryRead, owner: AGENT } });

    const error = await captureError(() => deployExecutor({ chain, file, artifact: ARTIFACT }));

    expect(error.kind).toBe('readBackMismatch');
    expect(error.detail).toContain('owner()');
  });
});

describe('the bytecode comes from the compiler and from nowhere else', () => {
  it('reads the compiled contract this repository builds', () => {
    const artifact = executorArtifact();

    expect(artifact.bytecode.startsWith('0x60')).toBe(true);
    expect(artifact.abi.length).toBeGreaterThan(0);
  });

  it('refuses a file that holds no compiled contract', () => {
    const empty = join(directory, 'AgentExecutor.json');
    writeFileSync(empty, JSON.stringify({ abi: [] }), 'utf8');

    expect(() => executorArtifact(empty)).toThrow(/nothing to deploy/);
  });

  it('refuses a missing file rather than deploying nothing', () => {
    expect(() => executorArtifact(join(directory, 'absent.json'))).toThrow(/nothing to deploy/);
  });
});

describe('the evidence log survives whatever is already in it', () => {
  it('appends to a log that already holds another action', async () => {
    const earlier: Anchor = {
      at: new Date().toISOString(),
      action: 'deploy-executor',
      chainId: CHAIN_ID,
      transactionHash: hash('ea1'),
      blockNumber: '11510400',
      status: 'reverted',
      contract: null,
    };
    appendRecord(file, earlier);
    const { chain } = fakeChain({ reads: registryRead });

    await deployExecutor({ chain, file, artifact: ARTIFACT });

    expect(anchors()).toHaveLength(2);
  });
});

const SET_ACTION_HASH = hash('5e7');

const EXECUTOR_SLOT = requireAddress('executor');

interface Call {
  role: SignerRole;
  contract: `0x${string}`;
  functionName: string;
  args: readonly unknown[];
}

const REGISTERED: ActionSpec = { supported: true, hasAmount: true, amountIndex: 2 };

const fakeOwner = (
  overrides: { receipt?: Receipt; spec?: Partial<ActionSpec> } = {},
): { calls: Call[]; reads: number; chain: ActionChain } => {
  const calls: Call[] = [];
  const counted = { reads: 0 };
  return {
    calls,
    get reads() {
      return counted.reads;
    },
    chain: {
      write: (role, contract, _artifact, functionName, args) => {
        calls.push({ role, contract, functionName, args });
        return Promise.resolve(SET_ACTION_HASH);
      },
      receipt: () => Promise.resolve(overrides.receipt ?? receipt({ contractAddress: null })),
      readAction: () => {
        counted.reads += 1;
        return Promise.resolve({ ...REGISTERED, ...overrides.spec });
      },
    },
  };
};

const registered = (spec: Partial<ActionSpec>) => async (): Promise<unknown> =>
  registerAction({ chain: fakeOwner({ spec }).chain, file, artifact: ARTIFACT });

describe('the permitted action is registered by the owner, never by the agent', () => {
  it('sets transferFrom on the deployed executor with the amount read from argument 2', async () => {
    const owner = fakeOwner();

    const registration = await registerAction({ chain: owner.chain, file, artifact: ARTIFACT });

    expect(owner.calls).toEqual([
      {
        role: 'principal',
        contract: EXECUTOR_SLOT,
        functionName: 'setAction',
        args: [PERMITTED_ACTION.selector, true, true, 2],
      },
    ]);
    expect(registration).toEqual({
      transactionHash: SET_ACTION_HASH,
      blockNumber: '11510500',
      spec: REGISTERED,
    });
  });

  it('captures the registration in the evidence log against the executor it configured', async () => {
    const owner = fakeOwner();

    await registerAction({ chain: owner.chain, file, artifact: ARTIFACT });

    expect(anchors()).toEqual([
      {
        at: expect.any(String) as string,
        action: 'register-action',
        chainId: CHAIN_ID,
        transactionHash: SET_ACTION_HASH,
        blockNumber: '11510500',
        status: 'success',
        contract: EXECUTOR_SLOT,
      },
    ]);
  });

  it('records a reverted registration and reads nothing back, because nothing was configured', async () => {
    const owner = fakeOwner({ receipt: receipt({ status: 'reverted', contractAddress: null }) });

    const error = await captureError(() =>
      registerAction({ chain: owner.chain, file, artifact: ARTIFACT }),
    );

    expect(error.kind).toBe('writeUnconfirmed');
    expect(anchors()[0]?.status).toBe('reverted');
    expect(owner.reads).toBe(0);
  });
});

describe('all three fields are read back, because a wrong one disables the cap silently', () => {
  it('refuses an action the executor does not report as supported', async () => {
    const error = await captureError(registered({ supported: false }));

    expect(error.kind).toBe('readBackMismatch');
    expect(error.detail).toContain('supported');
  });

  it('refuses an action gated at amount zero, which is what hasAmount false means', async () => {
    const error = await captureError(registered({ hasAmount: false }));

    expect(error.kind).toBe('readBackMismatch');
    expect(error.detail).toContain('hasAmount');
  });

  it('refuses an amount index that reads the recipient address as the amount', async () => {
    const error = await captureError(registered({ amountIndex: 1 }));

    expect(error.kind).toBe('readBackMismatch');
    expect(error.detail).toContain('amountIndex');
  });
});
