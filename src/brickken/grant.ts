import { ANCHOR_FILE, confirmAnchor, refuseRepeat, type AnchorAction } from '../chain/anchors.js';
import { signTypedDataAs, transactionReceipt, type Receipt } from '../chain/client.js';
import {
  grantMandateDomain,
  grantMandateMessage,
  grantMandateTypedData,
  type GrantMandateMessage,
} from '../chain/mandate.js';
import { readRegistryState } from '../chain/registry.js';
import {
  CHAIN_ID,
  KEEPER_MANDATE,
  identityRef,
  requireAddress,
  type MandateSpec,
} from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { createBrickkenClient, type BrickkenClient } from './client.js';
import { EVIDENCE_FILE, sdkWrite } from './log.js';
import { sdkClient, type GrantMandateInput, type WriteResult } from './sdk.js';
import { settledHash, type Settlement } from './settlement.js';
import { readTypedData, requireSamePayload } from './typed-data.js';

const SIGNER = 'principal' as const;

const GRANT: AnchorAction = 'grant-mandate';

export interface GrantSurface {
  status: BrickkenClient['getRamsStatus'];
  typedData: BrickkenClient['getGrantMandateTypedData'];
  settled: BrickkenClient['getTransactionStatus'];
  send: (input: GrantMandateInput) => Promise<WriteResult>;
  chainNonce: () => Promise<bigint>;
  sign: (message: GrantMandateMessage) => Promise<`0x${string}`>;
}

const sandbox = () => sdkClient(SIGNER);

const SURFACE: GrantSurface = {
  status: (query) => createBrickkenClient().getRamsStatus(query),
  typedData: (query) => createBrickkenClient().getGrantMandateTypedData(query),
  settled: (txId) => createBrickkenClient().getTransactionStatus(txId),
  send: (input) =>
    sandbox().rams.grantMandate(input, {
      execute: true,
      authorize: 'signature',
      signerAddress: requireAddress('principal'),
    }),
  chainNonce: async () => BigInt((await readRegistryState()).principalNonce),
  sign: (message) => signTypedDataAs(SIGNER, grantMandateTypedData(message)),
};

export const mandateQuery = (spec: MandateSpec): Record<string, string> => ({
  chainId: String(CHAIN_ID),
  agentMandateAddress: requireAddress('agentMandate'),
  agent: requireAddress(spec.agent),
  principal: requireAddress('principal'),
});

const asWhole = (value: unknown, what: string): bigint => {
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new KeeperError('brickkenUnreadable', `${what} reported no whole number`);
};

/** A replay number both sides do not agree on is never averaged, guessed, or preferred. */
async function agreedNonce(surface: GrantSurface, spec: MandateSpec): Promise<bigint> {
  const body = (await surface.status(mandateQuery(spec))) as Record<string, unknown> | null;
  const theirs = asWhole(body?.['nonce'], 'GET /rams/status');
  const ours = await surface.chainNonce();
  if (theirs !== ours)
    throw new KeeperError(
      'payloadMismatch',
      `the replay number: the chain says ${String(ours)}, Brickken say ${String(theirs)}`,
    );
  return ours;
}

export interface Reviewed {
  message: GrantMandateMessage;
  digest: `0x${string}`;
  nonce: bigint;
}

/** Reads cost nothing, so the whole authority is agreed before a signature exists anywhere. */
export async function reviewGrant(
  surface: GrantSurface = SURFACE,
  spec: MandateSpec = KEEPER_MANDATE,
): Promise<Reviewed> {
  const nonce = await agreedNonce(surface, spec);
  const message = grantMandateMessage({
    nowSeconds: Math.floor(Date.now() / 1000),
    nonce,
    identityRef,
    spec,
  });
  const body = await surface.typedData({
    ...mandateQuery(spec),
    complianceProvider: message.complianceProvider,
    identityRef: message.identityRef,
    asset: message.asset,
    validFrom: String(message.validFrom),
    validUntil: String(message.validUntil),
    maxTransactionValue: String(message.maxTransactionValue),
    maxCumulativeValue: String(message.maxCumulativeValue),
    metadata: message.metadata,
    actions: message.actions.join(','),
    deadline: String(message.deadline),
  });
  const digest = requireSamePayload(message, grantMandateDomain(), readTypedData(body));
  return { message, digest, nonce };
}

const grantInput = (message: GrantMandateMessage, signature: `0x${string}`): GrantMandateInput => ({
  chainId: CHAIN_ID,
  agentMandateAddress: requireAddress('agentMandate'),
  agent: message.agent,
  principal: message.principal,
  complianceProvider: message.complianceProvider,
  identityRef: message.identityRef,
  asset: message.asset,
  validFrom: String(message.validFrom),
  validUntil: String(message.validUntil),
  maxTransactionValue: String(message.maxTransactionValue),
  maxCumulativeValue: String(message.maxCumulativeValue),
  metadata: message.metadata,
  actions: [...message.actions],
  deadline: String(message.deadline),
  signature,
});

export interface GrantRun {
  surface?: GrantSurface;
  spec?: MandateSpec;
  action?: AnchorAction;
  anchors?: string;
  file?: string;
  receipt?: (hash: `0x${string}`) => Promise<Receipt>;
}

export async function grantMandate({
  surface = SURFACE,
  spec = KEEPER_MANDATE,
  action = GRANT,
  anchors = ANCHOR_FILE,
  file = EVIDENCE_FILE,
  receipt = transactionReceipt,
}: GrantRun = {}): Promise<Settlement> {
  refuseRepeat(action, anchors);
  const { message } = await reviewGrant(surface, spec);
  const signature = await surface.sign(message);

  const result = await sdkWrite(file, 'ramsGrantMandate', () =>
    surface.send(grantInput(message, signature)),
  );
  if (result.sent === undefined)
    throw new KeeperError('writeUnconfirmed', 'the grant prepared but never sent');

  const transactionHash = await settledHash(surface, result.txId);
  const { status } = await confirmAnchor(action, transactionHash, { file: anchors, receipt });
  if (status !== 'success') throw new KeeperError('writeUnconfirmed', `the grant is ${status}`);
  return { txId: result.txId, transactionHash };
}
