import {
  Brickken,
  PREPARE_PATH,
  type ApproveInput,
  type CreateTokenizationInput,
  type MintTokenInput,
  type UnsignedTransactionLike,
  type WhitelistInput,
  type WriteOptions,
  type WriteResult,
} from 'brickken-sdk';
import { fromPrivateKey } from 'brickken-sdk/adapters/private-key';

import { ANCHOR_FILE, confirmAnchor, type Anchor, type AnchorAction } from '../chain/anchors.js';
import { signerAddress, signerKey, transactionReceipt } from '../chain/client.js';
import type { Receipt, SignerRole } from '../chain/client.js';
import {
  BRICKKEN_API_BASE_URL,
  CHAIN_ID,
  HOLDER_EMAIL,
  PRINCIPAL_HOLDING,
  PRINCIPAL_HOLDING_WHOLE,
  SUNL_NAME,
  SUNL_SUPPLY,
  SUNL_SUPPLY_WHOLE,
  SUNL_SYMBOL,
  SUNL_TOKEN_TYPE,
  requireAddress,
} from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { appendRecord, readRecords } from '../shared/jsonl.js';
import { readSecret, scrubError } from '../shared/secrets.js';
import {
  API_KEY_VARIABLE,
  TOKENIZER_EMAIL_VARIABLE,
  createBrickkenClient,
  type TransactionStatus,
} from './client.js';
import { EVIDENCE_FILE, type RequestRecord } from './log.js';

/** Whoever creates the token keeps its mint and whitelist powers for life, so never the agent. */
const TOKENIZER: SignerRole = 'principal';

const NO_RETRY = { attempts: 1, baseDelayMs: 0, jitter: false };

const sandboxClient = (): Brickken =>
  new Brickken({
    baseUrl: BRICKKEN_API_BASE_URL,
    apiKey: readSecret(API_KEY_VARIABLE),
    signer: fromPrivateKey(signerKey(TOKENIZER)),
    retry: NO_RETRY,
  });

export interface Tokenization {
  create: (input: CreateTokenizationInput, options: WriteOptions) => Promise<WriteResult>;
  whitelist: (input: WhitelistInput, options: WriteOptions) => Promise<WriteResult>;
  mint: (input: MintTokenInput, options: WriteOptions) => Promise<WriteResult>;
  approve: (input: ApproveInput, options: WriteOptions) => Promise<WriteResult>;
  settled: (txId: string) => Promise<TransactionStatus>;
  tokenizer: () => `0x${string}`;
  email: () => string;
}

const SANDBOX: Tokenization = {
  create: (input, options) => sandboxClient().tokenization.create(input, options),
  whitelist: (input, options) => sandboxClient().tokenization.whitelist(input, options),
  mint: (input, options) => sandboxClient().tokenization.mint(input, options),
  approve: (input, options) => sandboxClient().tokenization.approve(input, options),
  settled: (txId) => createBrickkenClient().getTransactionStatus(txId),
  tokenizer: () => signerAddress(TOKENIZER),
  email: () => readSecret(TOKENIZER_EMAIL_VARIABLE),
};

const creationInput = (sandbox: Tokenization): CreateTokenizationInput => ({
  chainId: CHAIN_ID,
  tokenizerEmail: sandbox.email(),
  name: SUNL_NAME,
  tokenSymbol: SUNL_SYMBOL,
  tokenType: SUNL_TOKEN_TYPE,
  supplyCap: String(SUNL_SUPPLY_WHOLE),
  tokenizerAddress: sandbox.tokenizer(),
});

const whitelistInput = (sandbox: Tokenization): WhitelistInput => ({
  chainId: CHAIN_ID,
  tokenSymbol: SUNL_SYMBOL,
  userToWhitelist: [
    { investorAddress: sandbox.tokenizer(), investorEmail: HOLDER_EMAIL, whitelistStatus: true },
  ],
});

/** needWhitelist is false because the whitelist is its own confirmed write, never a side effect. */
const mintInput = (sandbox: Tokenization): MintTokenInput => ({
  chainId: CHAIN_ID,
  tokenSymbol: SUNL_SYMBOL,
  userToMint: [
    {
      investorEmail: HOLDER_EMAIL,
      investorAddress: sandbox.tokenizer(),
      amount: String(PRINCIPAL_HOLDING_WHOLE),
      needWhitelist: false,
    },
  ],
});

/** Above every cap, so the mandate is what refuses a transfer and never the allowance. */
const approveInput = (): ApproveInput => ({
  chainId: CHAIN_ID,
  tokenSymbol: SUNL_SYMBOL,
  spenderAddress: requireAddress('executor'),
  amount: String(PRINCIPAL_HOLDING_WHOLE),
});

/** Whether Brickken read a whole-token figure as whole tokens or took the digits literally. */
export type AmountWord = 'scaled' | 'unscaled' | 'absent';

const word = (value: bigint): string => value.toString(16).padStart(64, '0');

interface Figures {
  whole: bigint;
  scaled: bigint;
}

function amountWord(
  transactions: readonly UnsignedTransactionLike[],
  figures: Figures,
): AmountWord {
  const calldata = transactions
    .map((transaction) => transaction.data)
    .join('')
    .toLowerCase();
  if (calldata.includes(word(figures.scaled))) return 'scaled';
  if (calldata.includes(word(figures.whole))) return 'unscaled';
  return 'absent';
}

type Method = 'newTokenization' | 'whitelist' | 'mintToken' | 'approve';

type Send = (sandbox: Tokenization, options: WriteOptions) => Promise<WriteResult>;

async function recorded<T>(file: string, method: Method, run: () => Promise<T>): Promise<T> {
  const attempt = {
    at: new Date().toISOString(),
    surface: 'sdk',
    method,
    path: PREPARE_PATH,
  } as const;
  const record = (outcome: RequestRecord['outcome']): RequestRecord => ({ ...attempt, outcome });
  try {
    const value = await run();
    appendRecord(file, record('success'));
    return value;
  } catch (cause) {
    appendRecord(file, record('failure'));
    throw scrubError(cause);
  }
}

export interface WriteRun {
  sandbox?: Tokenization;
  file?: string;
  anchors?: string;
  receipt?: (hash: `0x${string}`) => Promise<Receipt>;
}

export interface Prepared {
  txId: string;
  transactions: UnsignedTransactionLike[];
  amount: AmountWord;
}

async function prepare(
  method: Method,
  { sandbox = SANDBOX, file = EVIDENCE_FILE }: WriteRun,
  send: Send,
  figures: Figures,
): Promise<Prepared> {
  const { txId, transactions } = await recorded(file, method, () =>
    send(sandbox, { signerAddress: sandbox.tokenizer() }),
  );
  if (txId === '' || transactions.length === 0)
    throw new KeeperError('brickkenUnreadable', 'the prepare returned no transaction to sign');
  return { txId, transactions, amount: amountWord(transactions, figures) };
}

/** Preparing is free and sending is one-shot, so what they would send is read first. */
export const prepareTokenCreation = (run: WriteRun = {}): Promise<Prepared> =>
  prepare(
    'newTokenization',
    run,
    (sandbox, options) => sandbox.create(creationInput(sandbox), options),
    { whole: SUNL_SUPPLY_WHOLE, scaled: SUNL_SUPPLY },
  );

export const prepareHoldingMint = (run: WriteRun = {}): Promise<Prepared> =>
  prepare('mintToken', run, (sandbox, options) => sandbox.mint(mintInput(sandbox), options), {
    whole: PRINCIPAL_HOLDING_WHOLE,
    scaled: PRINCIPAL_HOLDING,
  });

export interface Settlement {
  txId: string;
  transactionHash: `0x${string}`;
}

/** The hash a send reports back is not the hash that mines, so their records are asked instead. */
async function settledHash(sandbox: Tokenization, txId: string): Promise<`0x${string}`> {
  const { status, transactionHash } = await sandbox.settled(txId);
  if (status === 'rejected') throw new KeeperError('writeUnconfirmed', `Brickken rejected ${txId}`);
  if (transactionHash === null) throw new KeeperError('brickkenUnsettled', txId);
  return transactionHash;
}

function refuseRepeat(action: AnchorAction, anchors: string): void {
  const already = readRecords<Anchor>(anchors).find(
    (anchor) => anchor.action === action && anchor.status === 'success',
  );
  if (already !== undefined) throw new KeeperError('alreadyCreated', `${action} at ${already.at}`);
}

async function sendAndConfirm(
  action: AnchorAction,
  method: Method,
  run: WriteRun,
  send: Send,
): Promise<Settlement> {
  const {
    sandbox = SANDBOX,
    file = EVIDENCE_FILE,
    anchors = ANCHOR_FILE,
    receipt = transactionReceipt,
  } = run;
  refuseRepeat(action, anchors);

  const result = await recorded(file, method, () =>
    send(sandbox, { execute: true, signerAddress: sandbox.tokenizer() }),
  );
  if (result.sent === undefined)
    throw new KeeperError('writeUnconfirmed', 'the write prepared but never sent');

  const transactionHash = await settledHash(sandbox, result.txId);
  const { status } = await confirmAnchor(action, transactionHash, { file: anchors, receipt });
  if (status !== 'success') throw new KeeperError('writeUnconfirmed', `${action} is ${status}`);
  return { txId: result.txId, transactionHash };
}

/** A factory deploys the token, so the receipt names no contract and this claims no address. */
export const createToken = (run: WriteRun = {}): Promise<Settlement> =>
  sendAndConfirm('create-token', 'newTokenization', run, (sandbox, options) =>
    sandbox.create(creationInput(sandbox), options),
  );

export const whitelistHolder = (run: WriteRun = {}): Promise<Settlement> =>
  sendAndConfirm('whitelist-holder', 'whitelist', run, (sandbox, options) =>
    sandbox.whitelist(whitelistInput(sandbox), options),
  );

export const mintHolding = (run: WriteRun = {}): Promise<Settlement> =>
  sendAndConfirm('mint-holding', 'mintToken', run, (sandbox, options) =>
    sandbox.mint(mintInput(sandbox), options),
  );

export const prepareExecutorApproval = (run: WriteRun = {}): Promise<Prepared> =>
  prepare('approve', run, (sandbox, options) => sandbox.approve(approveInput(), options), {
    whole: PRINCIPAL_HOLDING_WHOLE,
    scaled: PRINCIPAL_HOLDING,
  });

export const approveExecutor = (run: WriteRun = {}): Promise<Settlement> =>
  sendAndConfirm('approve-executor', 'approve', run, (sandbox, options) =>
    sandbox.approve(approveInput(), options),
  );
