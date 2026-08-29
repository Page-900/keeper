import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CloseOfferInput, CreateStoInput, WriteOptions, WriteResult } from 'brickken-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Receipt } from '../src/chain/client.js';
import type { RequestRecord } from '../src/brickken/log.js';
import {
  AFTER_END,
  AFTER_START,
  BEFORE_START,
  attemptClose,
  offeringName,
  openAndRecord,
  openOffering,
  phaseAt,
  recordClose,
  type CloseAttempt,
  type Offering,
} from '../src/brickken/offering.js';
import { REHEARSAL, SUNL, supplyInBaseUnits } from '../src/shared/tokens.js';
import { SUNL_SUPPLY, SUNL_SYMBOL } from '../src/shared/config.js';
import { readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';

const ISSUER = `0x${'9a11ce'.padStart(40, '0')}` as const;
const FACTORY = `0x${'5701'.padStart(40, '0')}` as const;
const SETTLED = `0x${'c1'.repeat(32)}` as const;
const EMAIL = 'tokenizer@example.com';
const NOW = Date.parse('2026-08-28T10:00:00.000Z');

interface Call {
  input: CreateStoInput | CloseOfferInput;
  options: WriteOptions;
}

const writeResult = (overrides: Partial<WriteResult> = {}): WriteResult => ({
  txId: 'prepared-1',
  transactions: [{ to: FACTORY, data: '0x11223344' }],
  executionMode: 'client-signed',
  raw: {},
  sent: { transactionHashes: [SETTLED], raw: {} },
  ...overrides,
});

const prepareOnly = (): WriteResult => {
  const { sent, ...rest } = writeResult();
  void sent;
  return rest;
};

const fake = (
  result: WriteResult | Error = writeResult(),
  status: 'success' | 'rejected' = 'success',
): { calls: Call[]; offering: Offering } => {
  const calls: Call[] = [];
  const answer = (input: Call['input'], options: WriteOptions): Promise<WriteResult> => {
    calls.push({ input, options });
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  return {
    calls,
    offering: {
      create: answer,
      close: answer,
      settled: () => Promise.resolve({ status, transactionHash: SETTLED }),
      issuer: () => ISSUER,
      email: () => EMAIL,
    },
  };
};

const receipt = (): Promise<Receipt> =>
  Promise.resolve({
    status: 'success',
    blockNumber: 11_600_000n,
    contractAddress: null,
    gasUsed: 90_000n,
  });

let directory: string;
let file: string;
let anchors: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-rehearsal-'));
  file = join(directory, 'requests.jsonl');
  anchors = join(directory, 'anchors.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('the rehearsal token is disposable and is not the mandated asset', () => {
  it('carries a different symbol and name from the token every anchor sits on', () => {
    expect(REHEARSAL.symbol).not.toBe(SUNL.symbol);
    expect(REHEARSAL.name).not.toBe(SUNL.name);
    expect(SUNL.symbol).toBe(SUNL_SYMBOL);
  });

  it('scales a supply from the spec it was given and never from the mandated token', () => {
    expect(supplyInBaseUnits(SUNL)).toBe(SUNL_SUPPLY);
    expect(supplyInBaseUnits({ ...REHEARSAL, supplyWhole: 1n })).toBe(10n ** 18n);
  });

  it('names an offering after the token it is opened on', () => {
    expect(offeringName(REHEARSAL)).toBe('Keeper Rehearsal Offering');
    expect(offeringName(SUNL)).toBe('Sunrise Lodge Offering');
  });
});

describe('the phase names where the offering really is, not merely that it began', () => {
  const START = '2026-08-28T15:16:56.000Z';
  const END = '2026-08-28T18:16:56.000Z';
  const at = (iso: string): string => phaseAt(Date.parse(iso), START, END);

  it('separates not yet open from running from over', () => {
    expect(at('2026-08-28T15:00:00.000Z')).toBe(BEFORE_START);
    expect(at('2026-08-28T17:00:00.000Z')).toBe(AFTER_START);
    expect(at('2026-08-28T19:00:00.000Z')).toBe(AFTER_END);
  });
});

describe('opening an offering asks Brickken to send it and confirms it landed', () => {
  it('opens it on the token it was given, with a window this run chose', async () => {
    const { calls, offering } = fake();

    const opened = await openOffering('open-rehearsal-offering', {
      offering,
      spec: REHEARSAL,
      now: NOW,
      startsIn: 900,
      runsFor: 3600,
      file,
      anchors,
      receipt,
    });

    expect(calls[0]?.input).toMatchObject({ tokenSymbol: REHEARSAL.symbol });
    expect(calls[0]?.options).toEqual({ execute: true, signerAddress: ISSUER });
    expect(opened.window.startDate).toBe('2026-08-28T10:15:00.000Z');
    expect(opened.window.endDate).toBe('2026-08-28T11:15:00.000Z');
    expect(opened.transactionHash).toBe(SETTLED);
  });

  it('refuses to call it opened when Brickken prepared it and never sent it', async () => {
    const { offering } = fake(prepareOnly());

    const failure = await captureError(() =>
      openOffering('open-rehearsal-offering', {
        offering,
        spec: REHEARSAL,
        file,
        anchors,
        receipt,
      }),
    );

    expect(failure.kind).toBe('writeUnconfirmed');
  });

  it('refuses to open a second one over an offering it already anchored', async () => {
    const run = { spec: REHEARSAL, file, anchors, receipt };
    await openOffering('open-rehearsal-offering', { ...run, offering: fake().offering });

    const failure = await captureError(() =>
      openOffering('open-rehearsal-offering', { ...run, offering: fake().offering }),
    );

    expect(failure.kind).toBe('alreadyCreated');
  });
});

describe('closing captures the answer whether or not it is allowed', () => {
  it('reports a close that went through, with the hash Brickken settled it at', async () => {
    const { calls, offering } = fake();

    const attempt = await attemptClose('before it starts', {
      offering,
      spec: REHEARSAL,
      file,
      receipt,
    });

    expect(calls[0]?.input).toEqual({
      chainId: 11155111,
      tokenSymbol: REHEARSAL.symbol,
      tokenizerEmail: EMAIL,
    });
    expect(attempt).toMatchObject({ closed: true, transactionHash: SETTLED, refusal: null });
  });

  it('keeps a refusal as the result instead of throwing it away', async () => {
    const { offering } = fake(new Error('offering has not started'));

    const attempt = await attemptClose('before it starts', { offering, spec: REHEARSAL, file });

    expect(attempt.closed).toBe(false);
    expect(attempt.refusal).toContain('offering has not started');
    expect(attempt.transactionHash).toBeNull();
  });

  it('records the refusal in the request log too, so a failed attempt is never invisible', async () => {
    const { offering } = fake(new Error('nope'));

    await attemptClose('before it starts', { offering, spec: REHEARSAL, file });

    expect(readRecords<RequestRecord>(file)).toMatchObject([
      { surface: 'sdk', method: 'closeOffer', outcome: 'failure' },
    ]);
  });

  it('does not call it closed when the chain reverted the transaction Brickken settled', async () => {
    const { offering } = fake();
    const reverted = (): Promise<Receipt> =>
      Promise.resolve({
        status: 'reverted',
        blockNumber: 11_600_000n,
        contractAddress: null,
        gasUsed: 21_000n,
      });

    const attempt = await attemptClose('after it ends', {
      offering,
      spec: REHEARSAL,
      file,
      receipt: reverted,
    });

    expect(attempt.closed).toBe(false);
    expect(attempt.refusal).toContain('reverted');
    expect(attempt.transactionHash).toBe(SETTLED);
  });

  it('carries the block and the gas the chain really used', async () => {
    const attempt = await attemptClose('after it ends', {
      offering: fake().offering,
      spec: REHEARSAL,
      file,
      receipt,
    });

    expect(attempt).toMatchObject({ closed: true, blockNumber: '11600000', gasUsed: '90000' });
  });

  it('does not call it closed when Brickken rejected the transaction', async () => {
    const { offering } = fake(writeResult(), 'rejected');

    const attempt = await attemptClose('after it starts', { offering, spec: REHEARSAL, file });

    expect(attempt.closed).toBe(false);
    expect(attempt.refusal).toContain('rejected');
  });

  it('writes both attempts to the evidence, so neither answer can be dropped later', async () => {
    const captured = join(directory, 'closes.jsonl');
    const allowed = await attemptClose('after it ends', {
      offering: fake().offering,
      spec: REHEARSAL,
      file,
      receipt,
    });
    const refused = await attemptClose('before it starts', {
      offering: fake(new Error('too early')).offering,
      spec: REHEARSAL,
      file,
    });

    recordClose(captured, refused);
    recordClose(captured, allowed);

    expect(readRecords<CloseAttempt>(captured).map((held) => held.closed)).toEqual([false, true]);
  });
});

describe('an offering is recorded from what Brickken hold, never from our own arithmetic', () => {
  const theirs = {
    uuid: 'efd376d9',
    name: 'Sunrise Lodge Offering',
    status: 'ONGOING',
    startDate: '2026-09-01T00:00:00.000Z',
    endDate: '2026-09-08T00:00:00.000Z',
    tokenPrice: '50.0',
    acceptedCoin: 'BKN',
  };
  const reader = (listed: unknown[]): { listOfferings: () => Promise<unknown[]> } => ({
    listOfferings: () => Promise.resolve(listed),
  });

  it('writes their dates and their price, not the window this run computed', async () => {
    const opens = join(directory, 'opens.jsonl');

    const { record } = await openAndRecord('open-offering', {
      offering: fake().offering,
      spec: SUNL,
      now: NOW,
      runsFor: 60,
      file,
      anchors,
      receipt,
      opens,
      reader: reader([theirs]),
    });

    expect(record).toMatchObject({ symbol: SUNL.symbol, ...theirs });
    expect(readRecords<typeof record>(opens)).toHaveLength(1);
  });

  it('completes the record later without sending a second offering', async () => {
    const opens = join(directory, 'opens.jsonl');
    const run = { spec: SUNL, file, anchors, receipt, opens, reader: reader([theirs]) };
    await openAndRecord('open-offering', { ...run, offering: fake().offering });
    const { calls, offering } = fake();

    const { opened, record } = await openAndRecord('open-offering', { ...run, offering });

    expect(opened).toBeNull();
    expect(calls).toEqual([]);
    expect(record.uuid).toBe(theirs.uuid);
  });

  it('refuses to record anything when Brickken cannot confirm the offering exists', async () => {
    const opens = join(directory, 'opens.jsonl');

    const failure = await captureError(() =>
      openAndRecord('open-offering', {
        offering: fake().offering,
        spec: SUNL,
        file,
        anchors,
        receipt,
        opens,
        reader: reader([]),
      }),
    );

    expect(failure.kind).toBe('readBackMismatch');
    expect(readRecords(opens)).toEqual([]);
  });
});
