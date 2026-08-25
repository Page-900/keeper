import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ApproveInput,
  CreateTokenizationInput,
  MintTokenInput,
  WhitelistInput,
  WriteOptions,
  WriteResult,
} from 'brickken-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Anchor } from '../src/chain/anchors.js';
import type { TransactionStatus } from '../src/brickken/client.js';
import type { Receipt } from '../src/chain/client.js';
import {
  approveExecutor,
  createToken,
  mintHolding,
  prepareExecutorApproval,
  prepareHoldingMint,
  prepareTokenCreation,
  whitelistHolder,
  type Tokenization,
} from '../src/brickken/tokenization.js';
import type { RequestRecord } from '../src/brickken/log.js';
import {
  CHAIN_ID,
  HOLDER_EMAIL,
  requireAddress,
  MAX_CUMULATIVE_VALUE,
  MAX_TRANSACTION_VALUE,
  PRINCIPAL_HOLDING,
  PRINCIPAL_HOLDING_WHOLE,
  SUNL_NAME,
  SUNL_SUPPLY,
  SUNL_SUPPLY_WHOLE,
  SUNL_SYMBOL,
} from '../src/shared/config.js';
import { readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';

const address = (tail: string): `0x${string}` => `0x${tail.padStart(40, '0')}`;
const hash = (tail: string): `0x${string}` => `0x${tail.padStart(64, '0')}`;

const PRINCIPAL = address('9a11ce');
const TOKEN = address('50c1');
const CREATE_HASH = hash('c1');
const EMAIL = 'tokenizer@example.com';
const TX_ID = 'prepared-1';

const calldataFor = (value: bigint): `0x${string}` =>
  `0x23b872dd${value.toString(16).padStart(64, '0')}`;

interface Call {
  input: CreateTokenizationInput | WhitelistInput | MintTokenInput | ApproveInput;
  options: WriteOptions;
}

const writeResult = (overrides: Partial<WriteResult> = {}): WriteResult => ({
  txId: TX_ID,
  transactions: [{ to: PRINCIPAL, data: calldataFor(SUNL_SUPPLY) }],
  executionMode: 'client-signed',
  raw: {},
  ...overrides,
});

const settled = (overrides: Partial<TransactionStatus> = {}): TransactionStatus => ({
  status: 'success',
  transactionHash: CREATE_HASH,
  ...overrides,
});

const fakeSandbox = (
  result: WriteResult | Error = writeResult(),
  status: TransactionStatus = settled(),
): { calls: Call[]; sandbox: Tokenization } => {
  const calls: Call[] = [];
  const answer = (input: Call['input'], options: WriteOptions): Promise<WriteResult> => {
    calls.push({ input, options });
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  return {
    calls,
    sandbox: {
      create: (input, options) => answer(input, options),
      whitelist: (input, options) => answer(input, options),
      mint: (input, options) => answer(input, options),
      approve: (input, options) => answer(input, options),
      settled: () => Promise.resolve(status),
      tokenizer: () => PRINCIPAL,
      email: () => EMAIL,
    },
  };
};

const sent = (hashes: string[]): Partial<WriteResult> => ({
  sent: { transactionHashes: hashes, raw: {} },
});

const receipt = (overrides: Partial<Receipt> = {}): Receipt => ({
  status: 'success',
  blockNumber: 11_520_000n,
  contractAddress: TOKEN,
  gasUsed: 61_000n,
  ...overrides,
});

const receipts =
  (...answers: Receipt[]) =>
  (): Promise<Receipt> =>
    Promise.resolve(answers.shift() ?? receipt());

let directory: string;
let file: string;
let anchorFile: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-tokenization-'));
  file = join(directory, 'brickken-requests.jsonl');
  anchorFile = join(directory, 'chain-anchors.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const anchors = (): Anchor[] => readRecords<Anchor>(anchorFile);
const requests = (): RequestRecord[] => readRecords<RequestRecord>(file);

describe('the token is asked for in the terms this project decided on', () => {
  it('sends the name, symbol, class, and supply the config module declares', async () => {
    const { calls, sandbox } = fakeSandbox();

    await prepareTokenCreation({ sandbox, file });

    expect(calls[0]?.input).toEqual({
      chainId: CHAIN_ID,
      tokenizerEmail: EMAIL,
      name: SUNL_NAME,
      tokenSymbol: SUNL_SYMBOL,
      tokenType: 'RWA_TOKEN',
      supplyCap: String(SUNL_SUPPLY_WHOLE),
      tokenizerAddress: PRINCIPAL,
    });
  });

  it('names the principal as the signer, so the agent never becomes the tokenizer', async () => {
    const { calls, sandbox } = fakeSandbox();

    await prepareTokenCreation({ sandbox, file });

    expect(calls[0]?.options).toEqual({ signerAddress: PRINCIPAL });
  });

  it('prepares without sending, because a symbol is spent once', async () => {
    const { calls, sandbox } = fakeSandbox();

    await prepareTokenCreation({ sandbox, file });

    expect(calls[0]?.options.execute).toBeUndefined();
  });
});

describe('the prepared calldata is read before a one-shot creation is sent', () => {
  it('reports a scaled supply when the calldata carries the whole supply in base units', async () => {
    const { sandbox } = fakeSandbox();

    const prepared = await prepareTokenCreation({ sandbox, file });

    expect(prepared).toEqual({
      txId: TX_ID,
      transactions: [{ to: PRINCIPAL, data: calldataFor(SUNL_SUPPLY) }],
      amount: 'scaled',
    });
  });

  it('reports an unscaled supply when the calldata carries the bare digits instead', async () => {
    const bare = writeResult({ transactions: [{ to: PRINCIPAL, data: calldataFor(10_000n) }] });

    const prepared = await prepareTokenCreation({ sandbox: fakeSandbox(bare).sandbox, file });

    expect(prepared.amount).toBe('unscaled');
  });

  it('reports the supply absent rather than guessing when neither word appears', async () => {
    const neither = writeResult({ transactions: [{ to: PRINCIPAL, data: calldataFor(7n) }] });

    const prepared = await prepareTokenCreation({ sandbox: fakeSandbox(neither).sandbox, file });

    expect(prepared.amount).toBe('absent');
  });

  it('refuses a prepare that returned nothing to sign', async () => {
    const empty = writeResult({ transactions: [] });

    const error = await captureError(() =>
      prepareTokenCreation({ sandbox: fakeSandbox(empty).sandbox, file }),
    );

    expect(error.kind).toBe('brickkenUnreadable');
  });
});

describe('every call to Brickken is recorded, whatever it answers', () => {
  it('records a prepare that succeeded', async () => {
    const { sandbox } = fakeSandbox();

    await prepareTokenCreation({ sandbox, file });

    expect(requests()).toEqual([
      {
        at: expect.any(String) as string,
        surface: 'sdk',
        method: 'newTokenization',
        path: '/prepare-transactions',
        outcome: 'success',
      },
    ]);
  });

  it('records a prepare that was refused, before the refusal is rethrown', async () => {
    const { sandbox } = fakeSandbox(new Error('refused'));

    await expect(prepareTokenCreation({ sandbox, file })).rejects.toThrow();

    expect(requests().map((record) => record.outcome)).toEqual(['failure']);
  });
});

describe('the token is created once, and the chain is asked what happened', () => {
  it('returns what was sent and anchors the hash, the block, and the contract', async () => {
    const { sandbox } = fakeSandbox(writeResult(sent([CREATE_HASH])));

    const creation = await createToken({
      sandbox,
      file,
      anchors: anchorFile,
      receipt: receipts(),
    });

    expect(creation).toEqual({ txId: TX_ID, transactionHash: CREATE_HASH });
    expect(anchors()).toEqual([
      {
        at: expect.any(String) as string,
        action: 'create-token',
        chainId: CHAIN_ID,
        transactionHash: CREATE_HASH,
        blockNumber: '11520000',
        gasUsed: '61000',
        status: 'success',
        contract: TOKEN,
      },
    ]);
  });

  it('asks Brickken to send it, unlike the prepare run', async () => {
    const { calls, sandbox } = fakeSandbox(writeResult(sent([CREATE_HASH])));

    await createToken({ sandbox, file, anchors: anchorFile, receipt: receipts() });

    expect(calls[0]?.options).toEqual({ execute: true, signerAddress: PRINCIPAL });
  });

  it('records the anchor before it judges the outcome, so a revert is evidence too', async () => {
    const { sandbox } = fakeSandbox(writeResult(sent([CREATE_HASH])));

    const error = await captureError(() =>
      createToken({
        sandbox,
        file,
        anchors: anchorFile,
        receipt: receipts(receipt({ status: 'reverted', contractAddress: null })),
      }),
    );

    expect(error.kind).toBe('writeUnconfirmed');
    expect(anchors().map((anchor) => anchor.status)).toEqual(['reverted']);
  });

  it('refuses a second creation once the log records the first', async () => {
    const { sandbox } = fakeSandbox(writeResult(sent([CREATE_HASH])));
    const options = { sandbox, file, anchors: anchorFile, receipt: receipts() };
    await createToken(options);

    const error = await captureError(() => createToken(options));

    expect(error.kind).toBe('alreadyCreated');
    expect(anchors()).toHaveLength(1);
  });

  it('creates again when the only recorded attempt reverted, because nothing was created', async () => {
    const { sandbox } = fakeSandbox(writeResult(sent([CREATE_HASH])));
    const reverted = receipts(receipt({ status: 'reverted', contractAddress: null }));
    await captureError(() =>
      createToken({ sandbox, file, anchors: anchorFile, receipt: reverted }),
    );

    await createToken({ sandbox, file, anchors: anchorFile, receipt: receipts() });

    expect(anchors().map((anchor) => anchor.status)).toEqual(['reverted', 'success']);
  });

  it('takes the hash from their records, never the one the send reported', async () => {
    const other = hash('bad');
    const { sandbox } = fakeSandbox(writeResult(sent([other])), settled());

    const creation = await createToken({
      sandbox,
      file,
      anchors: anchorFile,
      receipt: receipts(),
    });

    expect(creation.transactionHash).toBe(CREATE_HASH);
    expect(anchors()[0]?.transactionHash).toBe(CREATE_HASH);
  });

  it('refuses a write that prepared but never sent', async () => {
    const { sandbox } = fakeSandbox(writeResult());

    const error = await captureError(() =>
      createToken({ sandbox, file, anchors: anchorFile, receipt: receipts() }),
    );

    expect(error.kind).toBe('writeUnconfirmed');
    expect(anchors()).toEqual([]);
  });

  it('names the prepared id when their records carry no hash yet, so it can be resumed', async () => {
    const unsettled = settled({ status: 'pending', transactionHash: null });
    const { sandbox } = fakeSandbox(writeResult(sent([CREATE_HASH])), unsettled);

    const error = await captureError(() =>
      createToken({ sandbox, file, anchors: anchorFile, receipt: receipts() }),
    );

    expect(error.kind).toBe('brickkenUnsettled');
    expect(error.message).toContain(TX_ID);
  });

  it('refuses a write their own records call rejected', async () => {
    const rejected = settled({ status: 'rejected' });
    const { sandbox } = fakeSandbox(writeResult(sent([CREATE_HASH])), rejected);

    const error = await captureError(() =>
      createToken({ sandbox, file, anchors: anchorFile, receipt: receipts() }),
    );

    expect(error.kind).toBe('writeUnconfirmed');
    expect(anchors()).toEqual([]);
  });

  it('anchors the empty contract a factory deploy leaves, rather than inventing an address', async () => {
    const { sandbox } = fakeSandbox(writeResult(sent([CREATE_HASH])));

    await createToken({
      sandbox,
      file,
      anchors: anchorFile,
      receipt: receipts(receipt({ contractAddress: null })),
    });

    expect(anchors()[0]?.contract).toBeNull();
  });
});

describe('the holder is whitelisted before anything is minted to it', () => {
  it('whitelists the principal wallet under an identity that is not the issuer', async () => {
    const { calls, sandbox } = fakeSandbox(writeResult(sent([CREATE_HASH])));

    await whitelistHolder({ sandbox, file, anchors: anchorFile, receipt: receipts() });

    expect(calls[0]?.input).toEqual({
      chainId: CHAIN_ID,
      tokenSymbol: SUNL_SYMBOL,
      userToWhitelist: [
        { investorAddress: PRINCIPAL, investorEmail: HOLDER_EMAIL, whitelistStatus: true },
      ],
    });
    expect(HOLDER_EMAIL).not.toBe(EMAIL);
  });

  it('anchors the whitelist under its own action, so the mint cannot claim it', async () => {
    const { sandbox } = fakeSandbox(writeResult(sent([CREATE_HASH])));

    await whitelistHolder({ sandbox, file, anchors: anchorFile, receipt: receipts() });

    expect(anchors().map((anchor) => anchor.action)).toEqual(['whitelist-holder']);
  });
});

describe('the holding is minted once, in whole tokens', () => {
  it('mints the holding the config module declares, and never whitelists as a side effect', async () => {
    const { calls, sandbox } = fakeSandbox(writeResult(sent([CREATE_HASH])));

    await mintHolding({ sandbox, file, anchors: anchorFile, receipt: receipts() });

    expect(calls[0]?.input).toEqual({
      chainId: CHAIN_ID,
      tokenSymbol: SUNL_SYMBOL,
      userToMint: [
        {
          investorEmail: HOLDER_EMAIL,
          investorAddress: PRINCIPAL,
          amount: String(PRINCIPAL_HOLDING_WHOLE),
          needWhitelist: false,
        },
      ],
    });
  });

  it('refuses a second mint, because a doubled holding breaks every cap the demo rests on', async () => {
    const { sandbox } = fakeSandbox(writeResult(sent([CREATE_HASH])));
    const run = { sandbox, file, anchors: anchorFile, receipt: receipts() };
    await mintHolding(run);

    const error = await captureError(() => mintHolding(run));

    expect(error.kind).toBe('alreadyCreated');
    expect(anchors()).toHaveLength(1);
  });

  it('reads the prepared mint before sending it, in the same way the creation was read', async () => {
    const scaled = writeResult({
      transactions: [{ to: PRINCIPAL, data: calldataFor(PRINCIPAL_HOLDING) }],
    });

    const prepared = await prepareHoldingMint({ sandbox: fakeSandbox(scaled).sandbox, file });

    expect(prepared.amount).toBe('scaled');
  });

  it('names an unscaled mint rather than sending a holding of dust', async () => {
    const bare = writeResult({
      transactions: [{ to: PRINCIPAL, data: calldataFor(PRINCIPAL_HOLDING_WHOLE) }],
    });

    const prepared = await prepareHoldingMint({ sandbox: fakeSandbox(bare).sandbox, file });

    expect(prepared.amount).toBe('unscaled');
  });

  it('records the mint under the method Brickken names it by', async () => {
    const { sandbox } = fakeSandbox(writeResult(sent([CREATE_HASH])));

    await mintHolding({ sandbox, file, anchors: anchorFile, receipt: receipts() });

    expect(requests().map((record) => record.method)).toEqual(['mintToken']);
  });
});

describe('the executor is allowed to spend, by more than the mandate ever permits', () => {
  it('approves the executor contract and never the agent wallet', async () => {
    const { calls, sandbox } = fakeSandbox(writeResult(sent([CREATE_HASH])));

    await approveExecutor({ sandbox, file, anchors: anchorFile, receipt: receipts() });

    expect(calls[0]?.input).toEqual({
      chainId: CHAIN_ID,
      tokenSymbol: SUNL_SYMBOL,
      spenderAddress: requireAddress('executor'),
      amount: String(PRINCIPAL_HOLDING_WHOLE),
    });
  });

  it('approves above both caps, so a refusal can never be blamed on the allowance', () => {
    expect(PRINCIPAL_HOLDING).toBeGreaterThan(MAX_CUMULATIVE_VALUE);
    expect(PRINCIPAL_HOLDING).toBeGreaterThan(MAX_TRANSACTION_VALUE);
  });

  it('reads the prepared approval before sending it', async () => {
    const scaled = writeResult({
      transactions: [{ to: PRINCIPAL, data: calldataFor(PRINCIPAL_HOLDING) }],
    });

    const prepared = await prepareExecutorApproval({ sandbox: fakeSandbox(scaled).sandbox, file });

    expect(prepared.amount).toBe('scaled');
  });

  it('anchors the approval under its own action', async () => {
    const { sandbox } = fakeSandbox(writeResult(sent([CREATE_HASH])));

    await approveExecutor({ sandbox, file, anchors: anchorFile, receipt: receipts() });

    expect(anchors().map((anchor) => anchor.action)).toEqual(['approve-executor']);
  });
});
