import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Anchor } from '../src/chain/anchors.js';
import type { Artifact, Receipt, Route, SignerRole } from '../src/chain/client.js';
import { allowRecipient, routeAction, type RouterChain } from '../src/chain/router.js';
import { PERMITTED_ACTION, SECOND_ACTION, requireAddress } from '../src/shared/config.js';
import { readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';

const ARTIFACT: Artifact = { abi: [], bytecode: '0x60806040' };

const HASH: `0x${string}` = `0x${'c0'.padStart(64, '0')}`;

interface Sent {
  role: SignerRole;
  contract: `0x${string}`;
  functionName: string;
  args: readonly unknown[];
}

const receipt = (overrides: Partial<Receipt> = {}): Receipt => ({
  status: 'success',
  blockNumber: 11_673_300n,
  contractAddress: null,
  gasUsed: 46_000n,
  ...overrides,
});

const fakeChain = (
  overrides: { receipt?: Receipt; route?: Route; allowed?: boolean } = {},
): { sent: Sent[]; chain: RouterChain } => {
  const sent: Sent[] = [];
  return {
    sent,
    chain: {
      write: (role, contract, _artifact, functionName, args) => {
        sent.push({ role, contract, functionName, args });
        return Promise.resolve(HASH);
      },
      receipt: () => Promise.resolve(overrides.receipt ?? receipt()),
      route: () =>
        Promise.resolve(
          overrides.route ?? { supported: true, recipientIndex: PERMITTED_ACTION.recipientIndex },
        ),
      allowed: () => Promise.resolve(overrides.allowed ?? true),
    },
  };
};

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-router-'));
  file = join(directory, 'chain-anchors.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const anchors = (): Anchor[] => readRecords<Anchor>(file);

describe('the router is configured by the investor and never by the agent', () => {
  it('sends every setting from the principal wallet to the router itself', async () => {
    const { sent, chain } = fakeChain();

    await routeAction(PERMITTED_ACTION, { chain, file, artifact: ARTIFACT });
    await allowRecipient('counterparty', { chain, file, artifact: ARTIFACT });

    expect(sent.map((one) => one.role)).toEqual(['principal', 'principal']);
    expect(sent.map((one) => one.contract)).toEqual([
      requireAddress('router'),
      requireAddress('router'),
    ]);
    expect(sent.map((one) => one.functionName)).toEqual(['setRoute', 'setAllowed']);
  });

  it('routes the transfer by its recipient argument and never by its amount argument', async () => {
    const { sent, chain } = fakeChain();

    await routeAction(PERMITTED_ACTION, { chain, file, artifact: ARTIFACT });

    expect(sent[0]?.args).toEqual([PERMITTED_ACTION.selector, true, 1]);
    expect(PERMITTED_ACTION.recipientIndex).not.toBe(PERMITTED_ACTION.amountIndex);
  });

  it('routes the second action by its spender, so the mandate stays what refuses it', async () => {
    const { sent, chain } = fakeChain({
      route: { supported: true, recipientIndex: SECOND_ACTION.recipientIndex },
    });

    await routeAction(SECOND_ACTION, { chain, file, artifact: ARTIFACT });

    expect(sent[0]?.args).toEqual([SECOND_ACTION.selector, true, 0]);
  });

  it('allows the buyer the policy settles to, read back off the chain', async () => {
    const { sent, chain } = fakeChain();

    await allowRecipient('counterparty', { chain, file, artifact: ARTIFACT });

    expect(sent[0]?.args).toEqual([requireAddress('counterparty'), true]);
  });

  it('refuses a route the chain reads back at a different argument', async () => {
    const { chain } = fakeChain({ route: { supported: true, recipientIndex: 2 } });

    const error = await captureError(() =>
      routeAction(PERMITTED_ACTION, { chain, file, artifact: ARTIFACT }),
    );

    expect(error.kind).toBe('readBackMismatch');
  });

  it('refuses a recipient the chain still says no to', async () => {
    const { chain } = fakeChain({ allowed: false });

    const error = await captureError(() =>
      allowRecipient('counterparty', { chain, file, artifact: ARTIFACT }),
    );

    expect(error.kind).toBe('readBackMismatch');
  });

  it('records a reverted setting rather than dropping it, and says so', async () => {
    const { chain } = fakeChain({ receipt: receipt({ status: 'reverted' }) });

    const error = await captureError(() =>
      allowRecipient('counterparty', { chain, file, artifact: ARTIFACT }),
    );

    expect(error.kind).toBe('writeUnconfirmed');
    expect(anchors()[0]?.status).toBe('reverted');
  });
});
