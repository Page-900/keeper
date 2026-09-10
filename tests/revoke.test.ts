import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Anchor } from '../src/chain/anchors.js';
import type { Receipt } from '../src/chain/client.js';
import {
  grantMandateDomain,
  revokeMandateMessage,
  revokeMandateTypedData,
} from '../src/chain/mandate.js';
import { revokeMandate, type RevokeSurface } from '../src/brickken/revoke.js';
import type { WriteResult } from '../src/brickken/sdk.js';
import { KEEPER_MANDATE, requireAddress } from '../src/shared/config.js';
import { readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';

const HASH: `0x${string}` = `0x${'ab'.padStart(64, '0')}`;
const SIGNATURE: `0x${string}` = `0x${'11'.padStart(130, '0')}`;
const NONCE = 7n;

const receipt = (status: Receipt['status'] = 'success'): Receipt => ({
  status,
  blockNumber: 11_680_000n,
  contractAddress: null,
  gasUsed: 51_000n,
});

interface Given {
  granted?: boolean;
  status?: Receipt['status'];
  theirs?: (ours: ReturnType<typeof revokeMandateTypedData>) => unknown;
}

const sent: { input: unknown }[] = [];

const surfaceOf = ({ granted = true, theirs }: Given = {}): RevokeSurface => ({
  granted: () => Promise.resolve(granted),
  chainNonce: () => Promise.resolve(NONCE),
  typedData: () => {
    const ours = revokeMandateTypedData(
      revokeMandateMessage({ nowSeconds: NOW, nonce: NONCE, agent: KEEPER_MANDATE.agent }),
    );
    return Promise.resolve(theirs === undefined ? { typedData: ours } : theirs(ours));
  },
  sign: () => Promise.resolve(SIGNATURE),
  send: (input) => {
    sent.push({ input });
    return Promise.resolve({
      txId: 'tx-revoke',
      sent: {},
      transactions: [],
      executionMode: 'signature',
      raw: {},
    } as unknown as WriteResult);
  },
  settled: () => Promise.resolve({ status: 'success', transactionHash: HASH } as never),
});

let NOW = 0;
let directory: string;
let anchors: string;
let evidence: string;

beforeEach(() => {
  NOW = Math.floor(Date.now() / 1000);
  sent.length = 0;
  directory = mkdtempSync(join(tmpdir(), 'keeper-revoke-'));
  anchors = join(directory, 'chain-anchors.jsonl');
  evidence = join(directory, 'brickken-requests.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const run = (given: Given = {}) =>
  revokeMandate({
    surface: surfaceOf(given),
    anchors,
    file: evidence,
    receipt: () => Promise.resolve(receipt(given.status)),
  });

const recorded = (): Anchor[] => readRecords<Anchor>(anchors);

describe('a revocation is signed by the investor and checked before it is signed', () => {
  it('revokes the address the mandate names, which is the router and not the wallet', async () => {
    await run();
    const input = sent[0]?.input as { agent: string; principal: string };

    expect(input.agent).toBe(requireAddress('router'));
    expect(input.principal).toBe(requireAddress('principal'));
  });

  it('anchors the revocation under its own name', async () => {
    await run();

    expect(recorded().map((one) => one.action)).toEqual(['revoke-mandate']);
    expect(recorded()[0]?.transactionHash).toBe(HASH);
  });

  it('refuses when there is no live mandate, rather than recording a revocation of nothing', async () => {
    const error = await captureError(() => run({ granted: false }));

    expect(error.kind).toBe('actionRefused');
    expect(recorded()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('refuses to sign a payload that is not the one it built', async () => {
    const error = await captureError(() =>
      run({
        theirs: (ours) => ({
          typedData: {
            ...ours,
            message: { ...ours.message, agent: requireAddress('agent') },
          },
        }),
      }),
    );

    expect(error.kind).toBe('payloadMismatch');
    expect(sent).toHaveLength(0);
  });

  it('refuses a payload that is for another instruction entirely', async () => {
    const error = await captureError(() =>
      run({ theirs: (ours) => ({ typedData: { ...ours, primaryType: 'GrantMandate' } }) }),
    );

    expect(error.kind).toBe('brickkenUnreadable');
    expect(sent).toHaveLength(0);
  });

  it('says so when the chain reverted it, and keeps the record either way', async () => {
    const error = await captureError(() => run({ status: 'reverted' }));

    expect(error.kind).toBe('writeUnconfirmed');
    expect(recorded()[0]?.status).toBe('reverted');
  });

  it('signs against the same domain the grant uses', () => {
    const message = revokeMandateMessage({
      nowSeconds: NOW,
      nonce: NONCE,
      agent: KEEPER_MANDATE.agent,
    });

    expect(revokeMandateTypedData(message).domain).toEqual(grantMandateDomain());
  });
});
