import { fileURLToPath } from 'node:url';

import {
  sdkClient,
  type CloseOfferInput,
  type CreateStoInput,
  type WriteOptions,
  type WriteResult,
} from './sdk.js';

import { transactionReceipt, type Receipt } from '../chain/client.js';
import {
  CHAIN_ID,
  OFFERING_AMOUNT_WHOLE,
  OFFERING_COIN,
  OFFERING_MAX_INVESTMENT,
  OFFERING_MAX_RAISE_USD,
  OFFERING_MIN_INVESTMENT,
  OFFERING_MIN_RAISE_USD,
  offeringWindow,
  type OfferingWindow,
} from '../shared/config.js';
import type { AnchorAction } from '../chain/anchors.js';
import { KeeperError } from '../shared/errors.js';
import { appendRecord } from '../shared/jsonl.js';
import { scrubError } from '../shared/secrets.js';
import { SUNL, type TokenSpec } from '../shared/tokens.js';
import { createBrickkenClient, type BrickkenClient, type TransactionStatus } from './client.js';
import { sendAndConfirm, type ConfirmRun } from './confirmed.js';
import { settledHash, type Settlement } from './settlement.js';
import { TOKENIZER, tokenizerAddress, tokenizerEmail } from './issuer.js';
import { EVIDENCE_FILE, sdkWrite } from './log.js';

export const OFFERING_FILE = fileURLToPath(
  new URL('../../evidence/offering-prepares.jsonl', import.meta.url),
);

export interface Offering {
  create: (input: CreateStoInput, options: WriteOptions) => Promise<WriteResult>;
  close: (input: CloseOfferInput, options: WriteOptions) => Promise<WriteResult>;
  settled: (txId: string) => Promise<TransactionStatus>;
  issuer: () => `0x${string}`;
  email: () => string;
}

const SANDBOX: Offering = {
  create: (input, options) => sdkClient(TOKENIZER).sto.create(input, options),
  close: (input, options) => sdkClient(TOKENIZER).sto.close(input, options),
  settled: (txId) => createBrickkenClient().getTransactionStatus(txId),
  issuer: tokenizerAddress,
  email: tokenizerEmail,
};

export const offeringName = (spec: TokenSpec): string => `${spec.name} Offering`;

/** Brickken derive the price as maxRaiseUSD divided by tokenAmount, so no price is sent. */
const offeringInput = (
  offering: Offering,
  spec: TokenSpec,
  window: OfferingWindow,
): CreateStoInput => ({
  chainId: CHAIN_ID,
  tokenizerEmail: offering.email(),
  tokenSymbol: spec.symbol,
  tokenAmount: String(OFFERING_AMOUNT_WHOLE),
  offeringName: offeringName(spec),
  startDate: window.startDate,
  endDate: window.endDate,
  acceptedCoin: OFFERING_COIN,
  minRaiseUSD: String(OFFERING_MIN_RAISE_USD),
  maxRaiseUSD: String(OFFERING_MAX_RAISE_USD),
  minInvestment: String(OFFERING_MIN_INVESTMENT),
  maxInvestment: String(OFFERING_MAX_INVESTMENT),
});

/** The one place a newSto body is built and sent, so no caller hand-rolls a second one. */
export const prepareOfferingOn = (
  spec: TokenSpec,
  { offering = SANDBOX, file = EVIDENCE_FILE, now = Date.now(), startsIn, runsFor }: OpenRun = {},
): Promise<WriteResult> =>
  sdkWrite(file, 'newSto', () =>
    offering.create(offeringInput(offering, spec, offeringWindow(now, startsIn, runsFor)), {
      signerAddress: offering.issuer(),
    }),
  );

export const OFFERING_CLOSES = fileURLToPath(
  new URL('../../evidence/offering-closes.jsonl', import.meta.url),
);

export interface OpenRun extends ConfirmRun {
  offering?: Offering;
  spec?: TokenSpec;
  now?: number;
  startsIn?: number;
  runsFor?: number;
}

export interface Opened extends Settlement {
  window: OfferingWindow;
}

export async function openOffering(
  action: AnchorAction,
  {
    offering = SANDBOX,
    spec = SUNL,
    now = Date.now(),
    startsIn,
    runsFor,
    ...confirm
  }: OpenRun = {},
): Promise<Opened> {
  const window = offeringWindow(now, startsIn, runsFor);
  const settlement = await sendAndConfirm(action, 'newSto', offering, confirm, () =>
    offering.create(offeringInput(offering, spec, window), {
      execute: true,
      signerAddress: offering.issuer(),
    }),
  );
  return { ...settlement, window };
}

const closeInput = (offering: Offering, spec: TokenSpec): CloseOfferInput => ({
  chainId: CHAIN_ID,
  tokenSymbol: spec.symbol,
  tokenizerEmail: offering.email(),
});

export interface CloseAttempt {
  at: string;
  symbol: string;
  phase: string;
  closed: boolean;
  txId: string | null;
  transactionHash: string | null;
  blockNumber: string | null;
  gasUsed: string | null;
  refusal: string | null;
}

export interface CloseRun {
  offering?: Offering;
  file?: string;
  spec?: TokenSpec;
  receipt?: (hash: `0x${string}`) => Promise<Receipt>;
}

/** A refusal is the answer this is looking for, so it is captured and never thrown away. */
export async function attemptClose(
  phase: string,
  {
    offering = SANDBOX,
    file = EVIDENCE_FILE,
    spec = SUNL,
    receipt = transactionReceipt,
  }: CloseRun = {},
): Promise<CloseAttempt> {
  const base = {
    at: new Date().toISOString(),
    symbol: spec.symbol,
    phase,
    txId: null,
    transactionHash: null,
    blockNumber: null,
    gasUsed: null,
  };
  try {
    const result = await sdkWrite(file, 'closeOffer', () =>
      offering.close(closeInput(offering, spec), {
        execute: true,
        signerAddress: offering.issuer(),
      }),
    );
    if (result.sent === undefined)
      return { ...base, closed: false, txId: result.txId, refusal: 'prepared but never sent' };
    const transactionHash = await settledHash(offering, result.txId);
    const settled = await receipt(transactionHash);
    return {
      ...base,
      closed: settled.status === 'success',
      txId: result.txId,
      transactionHash,
      blockNumber: String(settled.blockNumber),
      gasUsed: String(settled.gasUsed),
      refusal: settled.status === 'success' ? null : `the chain ${settled.status} it`,
    };
  } catch (cause) {
    return { ...base, closed: false, refusal: scrubError(cause).message };
  }
}

export function recordClose(file: string, attempt: CloseAttempt): CloseAttempt {
  appendRecord(file, attempt);
  return attempt;
}

export const OFFERING_OPENS = fileURLToPath(
  new URL('../../evidence/offering-opens.jsonl', import.meta.url),
);

export const BEFORE_START = 'before it starts';
export const AFTER_START = 'after it starts';
export const AFTER_END = 'after it ends';

export function phaseAt(nowMs: number, startDate: string, endDate: string): string {
  if (nowMs < Date.parse(startDate)) return BEFORE_START;
  return nowMs < Date.parse(endDate) ? AFTER_START : AFTER_END;
}

export interface HeldOffering {
  uuid: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  tokenPrice: string;
  acceptedCoin: string;
}

function readHeld(entry: unknown): HeldOffering | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const found = entry as Record<string, unknown>;
  const text = (field: string): string => {
    const value = found[field];
    return typeof value === 'string' ? value : '';
  };
  const held: HeldOffering = {
    uuid: text('uuid'),
    name: text('name'),
    status: text('status'),
    startDate: text('startDate'),
    endDate: text('endDate'),
    tokenPrice: text('tokenPrice'),
    acceptedCoin: text('acceptedCoin'),
  };
  return Object.values(held).includes('') ? null : held;
}

/** Their record of the offering, so the evidence carries their dates and never our arithmetic. */
export type OfferingReader = Pick<BrickkenClient, 'listOfferings'>;

export async function heldOffering(
  spec: TokenSpec = SUNL,
  file: string = EVIDENCE_FILE,
  reader: OfferingReader = createBrickkenClient(file),
): Promise<HeldOffering | null> {
  const listed = await reader.listOfferings(spec.symbol);
  const held = listed.map(readHeld).filter((entry) => entry !== null);
  if (listed.length > 0 && held.length !== listed.length)
    throw new KeeperError(
      'brickkenUnreadable',
      'GET /get-stos returned an offering of another shape',
    );
  return held.at(-1) ?? null;
}

export interface OpenRecord extends HeldOffering {
  at: string;
  symbol: string;
}

export function recordOpen(file: string, spec: TokenSpec, held: HeldOffering): OpenRecord {
  const record: OpenRecord = { at: new Date().toISOString(), symbol: spec.symbol, ...held };
  appendRecord(file, record);
  return record;
}

export interface OpenAndRecord extends OpenRun {
  opens?: string;
  reader?: OfferingReader;
}

/** Their listing can lag the chain, so recording it later must never send a second one. */
async function openedOrAlready(
  action: AnchorAction,
  spec: TokenSpec,
  run: OpenRun,
): Promise<Opened | null> {
  try {
    return await openOffering(action, { spec, ...run });
  } catch (cause) {
    if (cause instanceof KeeperError && cause.kind === 'alreadyCreated') return null;
    throw cause;
  }
}

/** Opened, then read back from Brickken before anything is recorded about it. */
export async function openAndRecord(
  action: AnchorAction,
  { spec = SUNL, opens = OFFERING_OPENS, reader, ...run }: OpenAndRecord = {},
): Promise<{ opened: Opened | null; record: OpenRecord }> {
  const opened = await openedOrAlready(action, spec, run);
  const held = await heldOffering(spec, run.file, reader);
  if (held === null)
    throw new KeeperError('readBackMismatch', `${spec.symbol} lists no offering after opening one`);
  return { opened, record: recordOpen(opens, spec, held) };
}
