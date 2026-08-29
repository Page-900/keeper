import {
  sdkClient,
  type ApproveInput,
  type CreateTokenizationInput,
  type MintTokenInput,
  type UnsignedTransactionLike,
  type WhitelistInput,
  type WriteOptions,
  type WriteResult,
} from './sdk.js';

import type { AnchorAction } from '../chain/anchors.js';
import type { Receipt } from '../chain/client.js';
import {
  CHAIN_ID,
  COUNTERPARTY_EMAIL,
  HOLDER_EMAIL,
  PRINCIPAL_HOLDING,
  PRINCIPAL_HOLDING_WHOLE,
  SUNL_SYMBOL,
  requireAddress,
} from '../shared/config.js';
import { SUNL, supplyInBaseUnits, type TokenSpec } from '../shared/tokens.js';
import { KeeperError } from '../shared/errors.js';
import { createBrickkenClient, type TransactionStatus } from './client.js';
import { TOKENIZER, tokenizerAddress, tokenizerEmail } from './issuer.js';
import { amountWord, type AmountWord, type Figures } from './calldata.js';
import { sendAndConfirm as confirmedWrite } from './confirmed.js';
import { EVIDENCE_FILE, sdkWrite } from './log.js';
import type { Settlement } from './settlement.js';

const sandboxClient = () => sdkClient(TOKENIZER);

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
  tokenizer: tokenizerAddress,
  email: tokenizerEmail,
};

const creationInput = (sandbox: Tokenization, spec: TokenSpec): CreateTokenizationInput => ({
  chainId: CHAIN_ID,
  tokenizerEmail: sandbox.email(),
  name: spec.name,
  tokenSymbol: spec.symbol,
  tokenType: spec.tokenType,
  supplyCap: String(spec.supplyWhole),
  tokenizerAddress: sandbox.tokenizer(),
});

const clearanceFor = (address: `0x${string}`, email: string): WhitelistInput => ({
  chainId: CHAIN_ID,
  tokenSymbol: SUNL_SYMBOL,
  userToWhitelist: [{ investorAddress: address, investorEmail: email, whitelistStatus: true }],
});

const whitelistInput = (sandbox: Tokenization): WhitelistInput =>
  clearanceFor(sandbox.tokenizer(), HOLDER_EMAIL);

const counterpartyInput = (): WhitelistInput =>
  clearanceFor(requireAddress('counterparty'), COUNTERPARTY_EMAIL);

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

type Method = 'newTokenization' | 'whitelist' | 'mintToken' | 'approve';

type Send = (sandbox: Tokenization, options: WriteOptions) => Promise<WriteResult>;

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
  const { txId, transactions } = await sdkWrite(file, method, () =>
    send(sandbox, { signerAddress: sandbox.tokenizer() }),
  );
  if (txId === '' || transactions.length === 0)
    throw new KeeperError('brickkenUnreadable', 'the prepare returned no transaction to sign');
  return { txId, transactions, amount: amountWord(transactions, figures) };
}

/** Preparing is free and sending is one-shot, so what they would send is read first. */
export const prepareTokenCreation = (
  run: WriteRun = {},
  spec: TokenSpec = SUNL,
): Promise<Prepared> =>
  prepare(
    'newTokenization',
    run,
    (sandbox, options) => sandbox.create(creationInput(sandbox, spec), options),
    { whole: spec.supplyWhole, scaled: supplyInBaseUnits(spec) },
  );

export const prepareHoldingMint = (run: WriteRun = {}): Promise<Prepared> =>
  prepare('mintToken', run, (sandbox, options) => sandbox.mint(mintInput(sandbox), options), {
    whole: PRINCIPAL_HOLDING_WHOLE,
    scaled: PRINCIPAL_HOLDING,
  });

const sendAndConfirm = (
  action: AnchorAction,
  method: Method,
  run: WriteRun,
  send: Send,
): Promise<Settlement> => {
  const { sandbox = SANDBOX, ...rest } = run;
  return confirmedWrite(action, method, sandbox, rest, () =>
    send(sandbox, { execute: true, signerAddress: sandbox.tokenizer() }),
  );
};

/** A factory deploys the token, so the receipt names no contract and this claims no address. */
export const createToken = (
  run: WriteRun = {},
  spec: TokenSpec = SUNL,
  action: AnchorAction = 'create-token',
): Promise<Settlement> =>
  sendAndConfirm(action, 'newTokenization', run, (sandbox, options) =>
    sandbox.create(creationInput(sandbox, spec), options),
  );

export const whitelistHolder = (run: WriteRun = {}): Promise<Settlement> =>
  sendAndConfirm('whitelist-holder', 'whitelist', run, (sandbox, options) =>
    sandbox.whitelist(whitelistInput(sandbox), options),
  );

/** A transfer to an uncleared address fails at the token layer, which is not the mandate. */
export const whitelistCounterparty = (run: WriteRun = {}): Promise<Settlement> =>
  sendAndConfirm('whitelist-counterparty', 'whitelist', run, (sandbox, options) =>
    sandbox.whitelist(counterpartyInput(), options),
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
