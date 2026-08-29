import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CloseOfferInput, CreateStoInput, WriteOptions, WriteResult } from 'brickken-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HoldingChange, SimulatedCall } from '../src/chain/client.js';
import type { RequestRecord } from '../src/brickken/log.js';
import { offeringName, type Offering } from '../src/brickken/offering.js';
import {
  prepareOffering,
  recordOffering,
  type OfferingRecord,
  type PreparedCall,
} from '../src/brickken/drawdown.js';
import { SUNL } from '../src/shared/tokens.js';
import {
  OFFERING_AMOUNT,
  OFFERING_AMOUNT_WHOLE,
  OFFERING_COIN,
  OFFERING_MAX_RUN_DAYS,
  SUNL_SYMBOL,
  requireAddress,
} from '../src/shared/config.js';
import { readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';

const address = (tail: string): `0x${string}` => `0x${tail.padStart(40, '0')}`;

const ISSUER = address('9a11ce');
const FACTORY = address('5701');
const EMAIL = 'tokenizer@example.com';
const TX_ID = 'prepared-sto-1';
const NOW = Date.parse('2026-08-28T10:00:00.000Z');
const TEN_MINUTES = 10 * 60 * 1000;

const word = (value: bigint): string => value.toString(16).padStart(64, '0');

const calldata = (selector: string, value: bigint): `0x${string}` => `0x${selector}${word(value)}`;

const OFFERED = calldata('11223344', OFFERING_AMOUNT);

const writeResult = (overrides: Partial<WriteResult> = {}): WriteResult => ({
  txId: TX_ID,
  transactions: [{ to: FACTORY, data: OFFERED }],
  executionMode: 'client-signed',
  raw: {},
  ...overrides,
});

const SETTLED = `0x${'c1'.repeat(32)}` as const;

interface Call {
  input: CreateStoInput | CloseOfferInput;
  options: WriteOptions;
}

const fakeOffering = (
  result: WriteResult | Error = writeResult(),
): { calls: Call[]; offering: Offering } => {
  const calls: Call[] = [];
  return {
    calls,
    offering: {
      create: (input, options) => {
        calls.push({ input, options });
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      },
      close: (input, options) => {
        calls.push({ input, options });
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      },
      settled: () => Promise.resolve({ status: 'success' as const, transactionHash: SETTLED }),
      issuer: () => ISSUER,
      email: () => EMAIL,
    },
  };
};

const holding = (before: bigint, after: bigint, ran = true): HoldingChange => ({
  before,
  after,
  ran,
});

const HELD = 1_750n * 10n ** 18n;

type Simulator = (calls: readonly SimulatedCall[]) => Promise<HoldingChange>;

const fakeSimulation = (
  change: HoldingChange = holding(HELD, HELD),
): { seen: SimulatedCall[][]; simulate: Simulator } => {
  const seen: SimulatedCall[][] = [];
  return {
    seen,
    simulate: (calls) => {
      seen.push([...calls]);
      return Promise.resolve(change);
    },
  };
};

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-offering-'));
  file = join(directory, 'requests.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const listing = (...counts: number[]): ((file: string) => Promise<number>) => {
  const answers = [...counts];
  return () => Promise.resolve(answers.shift() ?? 0);
};

const run = (
  offering: Offering,
  simulate: Simulator,
  listed = listing(0, 0),
): ReturnType<typeof prepareOffering> =>
  prepareOffering({ offering, file, now: NOW, simulate, listed });

describe('the offering is asked about and never opened', () => {
  it('sends every field Brickken accept and none of the three that do not exist', async () => {
    const { calls, offering } = fakeOffering();
    const { simulate } = fakeSimulation();

    await run(offering, simulate);

    expect(calls[0]?.input).toMatchObject({
      tokenizerEmail: EMAIL,
      tokenSymbol: SUNL_SYMBOL,
      tokenAmount: String(OFFERING_AMOUNT_WHOLE),
      offeringName: offeringName(SUNL),
      acceptedCoin: OFFERING_COIN,
    });
    const fields = Object.keys(calls[0]?.input ?? {});

    expect(fields).not.toContain('paymentTokenSymbol');
    expect(fields).not.toContain('totalTokensOffered');
    expect(fields).not.toContain('tokenPrice');
  });

  it('asks them to prepare and never to execute', async () => {
    const { calls, offering } = fakeOffering();
    const { simulate } = fakeSimulation();

    await run(offering, simulate);

    expect(calls[0]?.options).toEqual({ signerAddress: ISSUER });
  });

  it('opens the window well ahead of the call, because they check it at mining', async () => {
    const { offering } = fakeOffering();
    const { simulate } = fakeSimulation();

    const { window } = await run(offering, simulate);

    expect(Date.parse(window.startDate)).toBeGreaterThanOrEqual(NOW + TEN_MINUTES);
    expect(Date.parse(window.endDate)).toBeGreaterThan(Date.parse(window.startDate));
  });

  it('keeps the window short, because an offering cannot be closed before it ends', async () => {
    const { offering } = fakeOffering();
    const { simulate } = fakeSimulation();

    const { window } = await run(offering, simulate);
    const open = Date.parse(window.endDate) - Date.parse(window.startDate);

    expect(open / (24 * 60 * 60 * 1000)).toBeLessThanOrEqual(OFFERING_MAX_RUN_DAYS);
    expect(Date.parse(window.startDate) - NOW).toBeLessThan(60 * 60 * 1000);
  });

  it('refuses a result that says it was broadcast', async () => {
    const { offering } = fakeOffering(writeResult({ sent: { transactionHashes: [], raw: {} } }));
    const { simulate } = fakeSimulation();

    const failure = await captureError(() => run(offering, simulate));

    expect(failure.kind).toBe('offeringBroadcast');
  });

  it('refuses a prepare that returned nothing to sign', async () => {
    const { offering } = fakeOffering(writeResult({ transactions: [] }));
    const { simulate } = fakeSimulation();

    const failure = await captureError(() => run(offering, simulate));

    expect(failure.kind).toBe('brickkenUnreadable');
  });

  it('refuses to call it a prepare if Brickken start listing an offering that was not there', async () => {
    const { offering } = fakeOffering();
    const { simulate } = fakeSimulation();

    const failure = await captureError(() => run(offering, simulate, listing(0, 1)));

    expect(failure.kind).toBe('offeringBroadcast');
  });

  it('records the attempt on the SDK surface under the method Brickken name', async () => {
    const { offering } = fakeOffering();
    const { simulate } = fakeSimulation();

    await run(offering, simulate);

    expect(readRecords<RequestRecord>(file)).toMatchObject([
      { surface: 'sdk', method: 'newSto', outcome: 'success' },
    ]);
  });
});

describe('what the prepared transactions would do is read, not assumed', () => {
  it('names an address this project knows and marks one it does not', async () => {
    const transactions = [
      { to: requireAddress('asset'), data: OFFERED },
      { to: FACTORY, data: OFFERED },
    ];
    const { offering } = fakeOffering(writeResult({ transactions }));
    const { simulate } = fakeSimulation();

    const { calls } = await run(offering, simulate);

    expect(calls.map((call: PreparedCall) => call.target)).toEqual(['asset', 'unknown']);
    expect(calls[0]?.selector).toBe('0x11223344');
  });

  it('reads whether they took the offered figure as whole tokens or as base units', async () => {
    const only = (data: `0x${string}`): WriteResult =>
      writeResult({ transactions: [{ to: FACTORY, data }] });
    const { simulate } = fakeSimulation();

    const scaled = await run(fakeOffering().offering, simulate);
    const whole = only(calldata('11223344', OFFERING_AMOUNT_WHOLE));
    const unscaled = await run(fakeOffering(whole).offering, simulate);
    const missing = await run(fakeOffering(only('0x11223344')).offering, simulate);

    expect([scaled.amount, unscaled.amount, missing.amount]).toEqual([
      'scaled',
      'unscaled',
      'absent',
    ]);
  });

  it('simulates the prepared calls themselves, in the order they were returned', async () => {
    const second = { to: requireAddress('asset'), data: '0x55667788' as `0x${string}` };
    const transactions = [{ to: FACTORY, data: OFFERED }, second];
    const { offering } = fakeOffering(writeResult({ transactions }));
    const { seen, simulate } = fakeSimulation();

    await run(offering, simulate);

    expect(seen[0]).toEqual([
      { to: FACTORY, data: OFFERED, value: 0n },
      { to: second.to, data: second.data, value: 0n },
    ]);
  });
});

describe('the drawdown question is answered from the balance on both sides of the calls', () => {
  it('calls the holding untouched only when the two balances are the same', async () => {
    const { offering } = fakeOffering();

    const same = await run(offering, fakeSimulation(holding(HELD, HELD)).simulate);
    const less = await run(offering, fakeSimulation(holding(HELD, HELD - 1n)).simulate);
    const more = await run(offering, fakeSimulation(holding(HELD, HELD + 1n)).simulate);

    expect([same.verdict, less.verdict, more.verdict]).toEqual([
      'untouched',
      'reduced',
      'increased',
    ]);
  });

  it('answers nothing at all when a prepared call did not go through in the run', async () => {
    const { offering } = fakeOffering();
    const { simulate } = fakeSimulation(holding(HELD, HELD, false));

    const { verdict } = await run(offering, simulate);

    expect(verdict).toBe('undetermined');
  });
});

describe('the captured prepare is the anchor', () => {
  it('writes both balances exactly, and states that nothing was sent', async () => {
    const { offering } = fakeOffering();
    const { simulate } = fakeSimulation(holding(HELD, HELD));
    const captured = join(directory, 'offering.jsonl');

    recordOffering(captured, await run(offering, simulate));

    expect(readRecords<OfferingRecord>(captured)).toMatchObject([
      {
        txId: TX_ID,
        symbol: SUNL_SYMBOL,
        holdingBefore: String(HELD),
        holdingAfter: String(HELD),
        simulated: true,
        verdict: 'untouched',
        listedBefore: 0,
        listedAfter: 0,
        sent: false,
      },
    ]);
  });
});
