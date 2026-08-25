import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { grantMandate, reviewGrant, type GrantSurface } from '../src/brickken/grant.js';
import { grantMandateDomain, grantMandateMessage } from '../src/chain/mandate.js';
import { identityRef } from '../src/shared/config.js';
import { readRecords } from '../src/shared/jsonl.js';
import type { Anchor } from '../src/chain/anchors.js';
import type { RequestRecord } from '../src/brickken/log.js';
import { captureError } from './support/capture-error.js';

const HASH = `0x${'ab'.repeat(32)}` as const;
const SIGNATURE = `0x${'cd'.repeat(65)}` as const;

const envelope = (query: Record<string, string>): unknown => {
  const message = grantMandateMessage({
    nowSeconds: Number(query['validFrom']),
    nonce: 0n,
    identityRef,
  });
  return {
    typedData: {
      domain: grantMandateDomain(),
      primaryType: 'GrantMandate',
      types: { GrantMandate: [...GRANT_FIELDS] },
      message: {
        ...message,
        maxTransactionValue: String(message.maxTransactionValue),
        maxCumulativeValue: String(message.maxCumulativeValue),
        nonce: String(message.nonce),
        deadline: String(message.deadline),
        actions: [...message.actions],
      },
    },
  };
};

const GRANT_FIELDS = [
  { name: 'agent', type: 'address' },
  { name: 'validFrom', type: 'uint48' },
  { name: 'validUntil', type: 'uint48' },
  { name: 'principal', type: 'address' },
  { name: 'complianceProvider', type: 'address' },
  { name: 'identityRef', type: 'bytes32' },
  { name: 'asset', type: 'address' },
  { name: 'maxTransactionValue', type: 'uint256' },
  { name: 'maxCumulativeValue', type: 'uint256' },
  { name: 'metadata', type: 'bytes32' },
  { name: 'actions', type: 'bytes32[]' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
];

interface Calls {
  sent: number;
  signed: number;
}

const surfaceWith = (
  overrides: Partial<GrantSurface> = {},
): { surface: GrantSurface; calls: Calls } => {
  const calls: Calls = { sent: 0, signed: 0 };
  const surface: GrantSurface = {
    status: () => Promise.resolve({ nonce: '0' }),
    chainNonce: () => Promise.resolve(0n),
    typedData: (query) => Promise.resolve(envelope(query)),
    sign: () => {
      calls.signed += 1;
      return Promise.resolve(SIGNATURE);
    },
    send: () => {
      calls.sent += 1;
      return Promise.resolve({
        txId: 'prepared-1',
        transactions: [],
        executionMode: 'client-signed',
        sent: { ok: true },
      } as never);
    },
    settled: () => Promise.resolve({ status: 'success' as const, transactionHash: HASH }),
    ...overrides,
  };
  return { surface, calls };
};

let anchors: string;
let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-grant-'));
  anchors = join(directory, 'chain-anchors.jsonl');
  file = join(directory, 'brickken-requests.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const receipt = () =>
  Promise.resolve({
    status: 'success' as const,
    blockNumber: 11_558_200n,
    contractAddress: null,
    gasUsed: 190_000n,
  });

describe('the authority is agreed with Brickken before any signature exists', () => {
  it('returns the digest both sides describe', async () => {
    const { surface } = surfaceWith();

    expect((await reviewGrant(surface)).digest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('refuses when their replay number and the chain disagree, rather than choosing one', async () => {
    const { surface } = surfaceWith({ chainNonce: () => Promise.resolve(3n) });

    const error = await captureError(() => reviewGrant(surface));

    expect(error.kind).toBe('payloadMismatch');
    expect(error.detail).toContain('replay number');
  });

  it('refuses a replay number that is not a whole number', async () => {
    const { surface } = surfaceWith({ status: () => Promise.resolve({ nonce: 'soon' }) });

    const error = await captureError(() => reviewGrant(surface));

    expect(error.kind).toBe('brickkenUnreadable');
  });
});

describe('nothing is signed or sent unless the whole payload agrees', () => {
  it('does not sign when their payload raises a cap', async () => {
    const { surface, calls } = surfaceWith({
      typedData: (query) => {
        const body = envelope(query) as { typedData: { message: Record<string, unknown> } };
        body.typedData.message['maxCumulativeValue'] = '999000000000000000000000';
        return Promise.resolve(body);
      },
    });

    const error = await captureError(() => grantMandate({ surface, anchors, receipt, file }));

    expect(error.kind).toBe('payloadMismatch');
    expect(calls.signed).toBe(0);
    expect(calls.sent).toBe(0);
  });

  it('signs once and sends once when everything agrees', async () => {
    const { surface, calls } = surfaceWith();

    const settlement = await grantMandate({ surface, anchors, receipt, file });

    expect(settlement.transactionHash).toBe(HASH);
    expect(calls.signed).toBe(1);
    expect(calls.sent).toBe(1);
  });
});

describe('a mandate is granted once, because a second grant spends the replay number', () => {
  it('refuses a second grant after one has succeeded', async () => {
    const { surface } = surfaceWith();
    await grantMandate({ surface, anchors, receipt, file });

    const error = await captureError(() => grantMandate({ surface, anchors, receipt, file }));

    expect(error.kind).toBe('alreadyCreated');
  });
});

describe('the hash that mines is the only one recorded', () => {
  it('takes the hash from their status endpoint and confirms it on the chain', async () => {
    const { surface } = surfaceWith();

    await grantMandate({ surface, anchors, receipt, file });

    const [anchor] = readRecords<Anchor>(anchors);
    expect(anchor?.transactionHash).toBe(HASH);
    expect(anchor?.blockNumber).toBe('11558200');
  });

  it('records a reverted grant as evidence rather than throwing it away', async () => {
    const { surface } = surfaceWith();
    const reverted = () =>
      Promise.resolve({
        status: 'reverted' as const,
        blockNumber: 11_558_201n,
        contractAddress: null,
        gasUsed: 54_000n,
      });

    const error = await captureError(() =>
      grantMandate({ surface, anchors, receipt: reverted, file }),
    );

    expect(error.kind).toBe('writeUnconfirmed');
    expect(readRecords<Anchor>(anchors)).toHaveLength(1);
  });

  it('refuses a send that never reported being sent', async () => {
    const { surface } = surfaceWith({
      send: () => Promise.resolve({ txId: 'prepared-1', transactions: [] } as never),
    });

    const error = await captureError(() => grantMandate({ surface, anchors, receipt, file }));

    expect(error.kind).toBe('writeUnconfirmed');
  });
});

describe('the call that grants the authority is recorded like every other call', () => {
  it('writes one request record naming the method that was used', async () => {
    const { surface } = surfaceWith();

    await grantMandate({ surface, anchors, receipt, file });

    expect(readRecords<RequestRecord>(file)).toEqual([
      {
        at: expect.any(String) as string,
        surface: 'sdk',
        method: 'ramsGrantMandate',
        path: expect.any(String) as string,
        outcome: 'success',
      },
    ]);
  });

  it('records the attempt even when Brickken refuse it', async () => {
    const { surface } = surfaceWith({
      send: () => Promise.reject(new Error('their sandbox said no')),
    });

    await expect(grantMandate({ surface, anchors, receipt, file })).rejects.toThrow();

    expect(readRecords<RequestRecord>(file).map((record) => record.outcome)).toEqual(['failure']);
  });
});
