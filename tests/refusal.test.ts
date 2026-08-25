import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContractFunctionRevertedError, encodeErrorResult } from 'viem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EXECUTOR_ARTIFACT, compiledArtifact } from '../src/chain/artifacts.js';
import { revertReason } from '../src/chain/client.js';
import type { Anchor } from '../src/chain/anchors.js';
import {
  REFUSAL_FILE,
  recordRefusal,
  sendRefusedAction,
  type Refusal,
  type RefusalChain,
  type RefusalSender,
} from '../src/chain/refusal.js';
import type { RegistryRead } from '../src/chain/registry.js';
import { CHAIN_ID, PERMITTED_ACTION, requireAddress } from '../src/shared/config.js';
import { readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';

const PRINCIPAL = requireAddress('principal');
const AGENT = requireAddress('agent');
const ASSET = requireAddress('asset');
const CAP = 250_000_000_000_000_000_000n;
const BLOCK = 11_558_500n;

const state = (overrides: Partial<RegistryRead> = {}): RegistryRead => ({
  at: '2026-08-25T00:00:00.000Z',
  chainId: CHAIN_ID,
  registry: requireAddress('agentMandate'),
  executor: requireAddress('executor'),
  principal: PRINCIPAL,
  agent: AGENT,
  blockNumber: String(BLOCK),
  mandateGranted: true,
  mandateValidUntil: '1792773729',
  mandateAgent: AGENT,
  mandateAsset: ASSET,
  mandateRevoked: false,
  maxTransactionValue: String(CAP),
  maxCumulativeValue: String(CAP * 4n),
  cumulativeUsed: String(CAP),
  actionEnabled: true,
  agentFrozen: false,
  principalNonce: '1',
  principalEligible: true,
  eligibilityReason: 0,
  eligibilityExpiresAt: '0',
  executorMayRecord: true,
  ...overrides,
});

const REVERT = {
  error: 'CannotExecute',
  args: [AGENT, ASSET, PERMITTED_ACTION.selector, String(CAP + 1n)],
};

interface Asked {
  amount: bigint;
  atBlock: bigint;
}

const fakeChain = (
  overrides: Partial<RefusalChain> & { read?: RegistryRead } = {},
): { asked: Asked[]; chain: RefusalChain } => {
  const asked: Asked[] = [];
  const chain: RefusalChain = {
    state: () => Promise.resolve(overrides.read ?? state()),
    canExecute: (amount, atBlock) => {
      asked.push({ amount, atBlock });
      return Promise.resolve(amount <= CAP);
    },
    simulate: () => Promise.resolve(REVERT),
    ...Object.fromEntries(Object.entries(overrides).filter(([name]) => name !== 'read')),
  };
  return { asked, chain };
};

let directory: string;
let file: string;
let anchors: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-refusal-'));
  file = join(directory, 'refusals.jsonl');
  anchors = join(directory, 'chain-anchors.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('the refusal is pinned to one rule before it is written down', () => {
  it('records the cap refusal when the answer flips on the amount alone', async () => {
    const { chain } = fakeChain();

    const record = await recordRefusal({ chain, file });

    expect(record.rule).toBe('maxTransactionValue');
    expect(record.decidedBy).toBe('mandate');
    expect(record.reportedBy).toBe('executor');
    expect(record.allowedAmount).toBe(String(CAP));
    expect(record.refusedAmount).toBe(String(CAP + 1n));
    expect(record.allowedAnswer).toBe(true);
    expect(record.refusedAnswer).toBe(false);
    expect(record.revert.error).toBe('CannotExecute');
    expect(readRecords<Refusal>(file)).toHaveLength(1);
  });

  it('asks both amounts at the block the state was read at, so the pair is one moment', async () => {
    const { asked, chain } = fakeChain();

    await recordRefusal({ chain, file });

    expect(asked).toEqual([
      { amount: CAP, atBlock: BLOCK },
      { amount: CAP + 1n, atBlock: BLOCK },
    ]);
  });

  it('writes nothing when the lifetime cap would refuse the amount as well', async () => {
    const { chain } = fakeChain({ read: state({ cumulativeUsed: String(CAP * 4n) }) });

    const error = await captureError(() => recordRefusal({ chain, file }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(readRecords<Refusal>(file)).toHaveLength(0);
  });

  it('writes nothing when the amount inside the cap is refused too, because something else refused it', async () => {
    const { chain } = fakeChain({ canExecute: () => Promise.resolve(false) });

    const error = await captureError(() => recordRefusal({ chain, file }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(readRecords<Refusal>(file)).toHaveLength(0);
  });

  it('writes nothing when the mandate permits an amount over the cap it published', async () => {
    const { chain } = fakeChain({ canExecute: () => Promise.resolve(true) });

    const error = await captureError(() => recordRefusal({ chain, file }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(readRecords<Refusal>(file)).toHaveLength(0);
  });

  it('writes nothing when the executor would run the refused amount without reverting', async () => {
    const { chain } = fakeChain({ simulate: () => Promise.resolve(null) });

    const error = await captureError(() => recordRefusal({ chain, file }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(readRecords<Refusal>(file)).toHaveLength(0);
  });
});

describe('the evidence file is fixed to the project, not to the shell', () => {
  it('resolves the same path whatever directory the command was run from', () => {
    expect(REFUSAL_FILE).toContain('evidence');
    expect(REFUSAL_FILE.endsWith('refusals.jsonl')).toBe(true);
  });
});

describe('the revert is decoded, never guessed', () => {
  it('names the custom error and its arguments', () => {
    const { abi } = compiledArtifact(EXECUTOR_ARTIFACT);
    const data = encodeErrorResult({
      abi,
      errorName: 'CannotExecute',
      args: [AGENT, ASSET, PERMITTED_ACTION.selector, CAP + 1n],
    });

    const reason = revertReason(
      new ContractFunctionRevertedError({ abi, data, functionName: 'execute' }),
    );

    expect(reason.error).toBe('CannotExecute');
    expect(reason.args).toEqual([AGENT, ASSET, PERMITTED_ACTION.selector, String(CAP + 1n)]);
  });

  it('refuses to invent a reason for a failure it cannot decode', () => {
    expect(() => revertReason(new Error('the endpoint hung up'))).toThrow();
  });
});

const HASH = `0x${'ac'.repeat(32)}` as const;

const GAS_LIMIT = 400_000n;

const fakeSender = (
  status: Anchor['status'] = 'reverted',
  gasUsed = 54_321n,
): { sent: bigint[]; sender: RefusalSender } => {
  const sent: bigint[] = [];
  const sender: RefusalSender = {
    gasLimit: GAS_LIMIT,
    send: (amount) => {
      sent.push(amount);
      return Promise.resolve(HASH);
    },
    receipt: () => Promise.resolve({ status, blockNumber: BLOCK, contractAddress: null, gasUsed }),
  };
  return { sent, sender };
};

describe('the refused transfer is only recorded when the chain actually refused it', () => {
  it('sends the amount the registry refused, and no other', async () => {
    const { chain } = fakeChain();
    const { sent, sender } = fakeSender();

    await sendRefusedAction({ chain, sender, file, anchors });

    expect(sent).toEqual([CAP + 1n]);
  });

  it('anchors the reverted transaction and writes the refusal that points at it', async () => {
    const { chain } = fakeChain();
    const { sender } = fakeSender();

    const { refusal, anchor } = await sendRefusedAction({ chain, sender, file, anchors });

    expect(anchor.action).toBe('agent-refusal');
    expect(anchor.status).toBe('reverted');
    expect(anchor.transactionHash).toBe(HASH);
    expect(refusal.transactionHash).toBe(HASH);
    expect(readRecords<Refusal>(file)).toHaveLength(1);
    expect(readRecords<Anchor>(anchors)).toHaveLength(1);
  });

  it('writes no refusal when the transfer mined instead of reverting', async () => {
    const { chain } = fakeChain();
    const { sender } = fakeSender('success');

    const error = await captureError(() => sendRefusedAction({ chain, sender, file, anchors }));

    expect(error.kind).toBe('writeUnconfirmed');
    expect(readRecords<Refusal>(file)).toHaveLength(0);
    expect(readRecords<Anchor>(anchors)).toHaveLength(1);
  });

  it('writes no refusal when the transaction ran out of gas instead of being refused', async () => {
    const { chain } = fakeChain();
    const { sender } = fakeSender('reverted', GAS_LIMIT);

    const error = await captureError(() => sendRefusedAction({ chain, sender, file, anchors }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(readRecords<Refusal>(file)).toHaveLength(0);
  });

  it('records the gas the refusal used, so out of gas can be ruled out by reading it', async () => {
    const { chain } = fakeChain();
    const { sender } = fakeSender();

    const { anchor } = await sendRefusedAction({ chain, sender, file, anchors });

    expect(anchor.gasUsed).toBe('54321');
  });

  it('writes no refusal when the mined revert is not the one that was simulated', async () => {
    const { chain } = fakeChain({
      simulate: (_amount, atBlock) =>
        Promise.resolve(atBlock === undefined ? REVERT : { error: 'CallFailed', args: [] }),
    });
    const { sender } = fakeSender();

    const error = await captureError(() => sendRefusedAction({ chain, sender, file, anchors }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(readRecords<Refusal>(file)).toHaveLength(0);
  });

  it('replays the refused call at the block before the one it mined in', async () => {
    const replayed: (bigint | undefined)[] = [];
    const { chain } = fakeChain({
      simulate: (_amount, atBlock) => {
        replayed.push(atBlock);
        return Promise.resolve(REVERT);
      },
    });
    const { sender } = fakeSender();

    await sendRefusedAction({ chain, sender, file, anchors });

    expect(replayed).toEqual([undefined, BLOCK - 1n]);
  });

  it('sends nothing when a refusal has already been anchored', async () => {
    const { chain } = fakeChain();
    const first = fakeSender();
    await sendRefusedAction({ chain, sender: first.sender, file, anchors });
    const second = fakeSender();

    const error = await captureError(() =>
      sendRefusedAction({ chain, sender: second.sender, file, anchors }),
    );

    expect(error.kind).toBe('alreadyCreated');
    expect(second.sent).toEqual([]);
  });

  it('sends nothing when the refusal cannot be pinned to the cap alone', async () => {
    const { chain } = fakeChain({ canExecute: () => Promise.resolve(false) });
    const { sent, sender } = fakeSender();

    const error = await captureError(() => sendRefusedAction({ chain, sender, file, anchors }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(sent).toEqual([]);
    expect(readRecords<Anchor>(anchors)).toHaveLength(0);
  });
});
