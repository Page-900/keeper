import { describe, expect, it, vi } from 'vitest';

import type { ConfirmationStatus, OutboundTransaction } from '../src/chain/client.js';
import { submitSequence, type Submitter } from '../src/chain/pipeline.js';
import { CHAIN_ID } from '../src/shared/config.js';
import { captureError } from './support/capture-error.js';

const EXECUTOR = '0x00000000000000000000000000000000000000e5';

const hashFor = (nonce: number): `0x${string}` => `0x${nonce.toString(16).padStart(64, '0')}`;

const transaction = (
  nonce: number,
  overrides: Partial<OutboundTransaction> = {},
): OutboundTransaction => ({
  to: EXECUTOR,
  data: '0x',
  value: 0n,
  gas: 21_000n,
  chainId: CHAIN_ID,
  nonce,
  ...overrides,
});

const fakeSubmitter = (
  statuses: ConfirmationStatus[] = [],
): { sent: OutboundTransaction[]; submitter: Submitter } => {
  const sent: OutboundTransaction[] = [];
  let confirmations = 0;
  return {
    sent,
    submitter: {
      send: (_role, outbound) => {
        sent.push(outbound);
        return Promise.resolve(hashFor(outbound.nonce));
      },
      confirm: () => Promise.resolve(statuses[confirmations++] ?? 'success'),
    },
  };
};

const confirmsState = () => vi.fn(() => Promise.resolve(true));

describe('a prepared batch is submitted in strict nonce order', () => {
  it('submits a three transaction response in ascending nonce order', async () => {
    const { sent, submitter } = fakeSubmitter();

    const hashes = await submitSequence(
      'agent',
      {
        transactions: [transaction(8), transaction(6), transaction(7)],
        confirmState: confirmsState(),
      },
      submitter,
    );

    expect(sent.map((outbound) => outbound.nonce)).toEqual([6, 7, 8]);
    expect(hashes).toEqual([hashFor(6), hashFor(7), hashFor(8)]);
  });

  it('confirms each transaction before it sends the next', async () => {
    const order: string[] = [];
    const submitter: Submitter = {
      send: (_role, outbound) => {
        order.push(`sent ${String(outbound.nonce)}`);
        return Promise.resolve(hashFor(outbound.nonce));
      },
      confirm: (hash) => {
        order.push(`confirmed ${String(BigInt(hash))}`);
        return Promise.resolve('success');
      },
    };

    await submitSequence(
      'agent',
      { transactions: [transaction(1), transaction(2)], confirmState: confirmsState() },
      submitter,
    );

    expect(order).toEqual(['sent 1', 'confirmed 1', 'sent 2', 'confirmed 2']);
  });

  it('aborts on a gap in the nonces rather than skipping ahead', async () => {
    const { sent, submitter } = fakeSubmitter();

    const error = await captureError(() =>
      submitSequence(
        'agent',
        { transactions: [transaction(4), transaction(6)], confirmState: confirmsState() },
        submitter,
      ),
    );

    expect(error.kind).toBe('nonceGap');
    expect(error.message).toContain('5');
    expect(sent).toEqual([]);
  });

  it('refuses a nonce that appears twice, because the second would replace the first', async () => {
    const { submitter } = fakeSubmitter();

    const error = await captureError(() =>
      submitSequence(
        'agent',
        { transactions: [transaction(3), transaction(3)], confirmState: confirmsState() },
        submitter,
      ),
    );

    expect(error.kind).toBe('sequenceMalformed');
  });

  it('refuses a transaction prepared for another chain', async () => {
    const { sent, submitter } = fakeSubmitter();

    const error = await captureError(() =>
      submitSequence(
        'agent',
        {
          transactions: [transaction(1), transaction(2, { chainId: 1 })],
          confirmState: confirmsState(),
        },
        submitter,
      ),
    );

    expect(error.kind).toBe('sequenceMalformed');
    expect(sent).toEqual([]);
  });

  it('refuses an empty batch instead of reporting success for nothing sent', async () => {
    const { submitter } = fakeSubmitter();

    const error = await captureError(() =>
      submitSequence('agent', { transactions: [], confirmState: confirmsState() }, submitter),
    );

    expect(error.kind).toBe('sequenceMalformed');
  });
});

describe('an unconfirmed write stops the sequence, it never retries', () => {
  it('halts the sequence when a transaction does not confirm, and never resends it', async () => {
    const { sent, submitter } = fakeSubmitter(['reverted']);
    const confirmState = confirmsState();

    const error = await captureError(() =>
      submitSequence(
        'agent',
        { transactions: [transaction(1), transaction(2), transaction(3)], confirmState },
        submitter,
      ),
    );

    expect(error.kind).toBe('writeUnconfirmed');
    expect(sent.map((outbound) => outbound.nonce)).toEqual([1]);
    expect(confirmState).not.toHaveBeenCalled();
  });

  it('refuses to finish when the read-back does not report the state written', async () => {
    const { submitter } = fakeSubmitter();

    const error = await captureError(() =>
      submitSequence(
        'agent',
        { transactions: [transaction(1)], confirmState: () => Promise.resolve(false) },
        submitter,
      ),
    );

    expect(error.kind).toBe('writeUnconfirmed');
  });

  it('names a transport failure as an unconfirmed write rather than leaking an unnamed error', async () => {
    const submitter: Submitter = {
      send: () => Promise.reject(new Error('nonce too low')),
      confirm: () => Promise.resolve('success'),
    };

    const error = await captureError(() =>
      submitSequence(
        'agent',
        { transactions: [transaction(1)], confirmState: confirmsState() },
        submitter,
      ),
    );

    expect(error.kind).toBe('writeUnconfirmed');
    expect(error.message).toContain('nonce too low');
  });

  it('reads the state back only after every transaction has confirmed', async () => {
    const { sent, submitter } = fakeSubmitter();
    const confirmState = vi.fn(() => {
      expect(sent.map((outbound) => outbound.nonce)).toEqual([1, 2]);
      return Promise.resolve(true);
    });

    await submitSequence(
      'agent',
      { transactions: [transaction(1), transaction(2)], confirmState },
      submitter,
    );

    expect(confirmState).toHaveBeenCalledTimes(1);
  });
});
