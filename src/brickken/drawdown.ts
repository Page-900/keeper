import { fileURLToPath } from 'node:url';

import type { UnsignedTransactionLike, WriteResult } from './sdk.js';

import { simulateHolding, type HoldingChange, type SimulatedCall } from '../chain/client.js';
import {
  OFFERING_AMOUNT,
  OFFERING_AMOUNT_WHOLE,
  OFFERING_COIN,
  SUNL_SYMBOL,
  addressNamed,
  offeringWindow,
  requireAddress,
  type AddressName,
  type OfferingWindow,
} from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { appendRecord } from '../shared/jsonl.js';
import { SUNL } from '../shared/tokens.js';
import { amountWord, selectorOf, type AmountWord } from './calldata.js';
import { createBrickkenClient } from './client.js';
import { EVIDENCE_FILE } from './log.js';
import { offeringName, prepareOfferingOn, type Offering } from './offering.js';

export const OFFERING_FILE = fileURLToPath(
  new URL('../../evidence/offering-prepares.jsonl', import.meta.url),
);

export type HoldingVerdict = 'untouched' | 'reduced' | 'increased' | 'undetermined';

export interface PreparedCall {
  to: `0x${string}`;
  target: AddressName | 'unknown';
  selector: string;
  bytes: number;
}

const asCall = (transaction: UnsignedTransactionLike): SimulatedCall => ({
  to: transaction.to,
  data: transaction.data,
  value: BigInt(transaction.value ?? '0x0'),
});

const asPreparedCall = (transaction: UnsignedTransactionLike): PreparedCall => ({
  to: transaction.to,
  target: addressNamed(transaction.to) ?? 'unknown',
  selector: selectorOf(transaction.data),
  bytes: transaction.data.length / 2 - 1,
});

const verdictOf = ({ before, after, ran }: HoldingChange): HoldingVerdict => {
  if (!ran) return 'undetermined';
  if (after < before) return 'reduced';
  if (after > before) return 'increased';
  return 'untouched';
};

const onChainHolding = (calls: readonly SimulatedCall[]): Promise<HoldingChange> =>
  simulateHolding(requireAddress('asset'), requireAddress('principal'), calls);

const offeringsListed = (file: string): Promise<number> =>
  createBrickkenClient(file).countOfferings(SUNL_SYMBOL);

export interface OfferingRun {
  offering?: Offering;
  file?: string;
  now?: number;
  simulate?: (calls: readonly SimulatedCall[]) => Promise<HoldingChange>;
  listed?: (file: string) => Promise<number>;
}

export interface OfferingPrepare {
  txId: string;
  window: OfferingWindow;
  calls: PreparedCall[];
  amount: AmountWord;
  holding: HoldingChange;
  verdict: HoldingVerdict;
  listedBefore: number;
  listedAfter: number;
}

const readable = (result: WriteResult): void => {
  if (result.txId === '' || result.transactions.length === 0)
    throw new KeeperError('brickkenUnreadable', 'the prepare returned no transaction to sign');
  if (result.sent !== undefined) throw new KeeperError('offeringBroadcast', result.txId);
};

/** Preparing returns what would be broadcast, and this path never asks them to broadcast it. */
export async function prepareOffering({
  offering,
  file = EVIDENCE_FILE,
  now = Date.now(),
  simulate = onChainHolding,
  listed = offeringsListed,
}: OfferingRun = {}): Promise<OfferingPrepare> {
  const window = offeringWindow(now);
  const listedBefore = await listed(file);
  const result = await prepareOfferingOn(SUNL, { ...(offering && { offering }), file, now });
  readable(result);
  const listedAfter = await listed(file);
  if (listedAfter !== listedBefore)
    throw new KeeperError('offeringBroadcast', `${SUNL_SYMBOL} now lists ${String(listedAfter)}`);
  const holding = await simulate(result.transactions.map(asCall));
  return {
    txId: result.txId,
    window,
    calls: result.transactions.map(asPreparedCall),
    amount: amountWord(result.transactions, {
      whole: OFFERING_AMOUNT_WHOLE,
      scaled: OFFERING_AMOUNT,
    }),
    holding,
    verdict: verdictOf(holding),
    listedBefore,
    listedAfter,
  };
}

export interface OfferingRecord {
  at: string;
  txId: string;
  symbol: string;
  offeringName: string;
  tokenAmount: string;
  acceptedCoin: string;
  startDate: string;
  endDate: string;
  calls: PreparedCall[];
  amount: AmountWord;
  holdingBefore: string;
  holdingAfter: string;
  simulated: boolean;
  verdict: HoldingVerdict;
  listedBefore: number;
  listedAfter: number;
  sent: false;
}

const asRecord = (prepared: OfferingPrepare): OfferingRecord => ({
  at: new Date().toISOString(),
  txId: prepared.txId,
  symbol: SUNL_SYMBOL,
  offeringName: offeringName(SUNL),
  tokenAmount: String(OFFERING_AMOUNT_WHOLE),
  acceptedCoin: OFFERING_COIN,
  startDate: prepared.window.startDate,
  endDate: prepared.window.endDate,
  calls: prepared.calls,
  amount: prepared.amount,
  holdingBefore: String(prepared.holding.before),
  holdingAfter: String(prepared.holding.after),
  simulated: prepared.holding.ran,
  verdict: prepared.verdict,
  listedBefore: prepared.listedBefore,
  listedAfter: prepared.listedAfter,
  sent: false,
});

export function recordOffering(file: string, prepared: OfferingPrepare): OfferingRecord {
  const record = asRecord(prepared);
  appendRecord(file, record);
  return record;
}
