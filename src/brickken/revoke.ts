import { ANCHOR_FILE, confirmAnchor, type AnchorAction } from '../chain/anchors.js';
import { signTypedDataAs, transactionReceipt, type Receipt } from '../chain/client.js';
import {
  grantMandateDomain,
  revokeMandateMessage,
  revokeMandateTypedData,
  type RevokeMandateMessage,
} from '../chain/mandate.js';
import { readRegistryState } from '../chain/registry.js';
import {
  CHAIN_ID,
  KEEPER_MANDATE,
  requireAddress,
  type AddressName,
  type MandateSpec,
} from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { createBrickkenClient, type BrickkenClient } from './client.js';
import { mandateQuery } from './grant.js';
import { EVIDENCE_FILE, sdkWrite } from './log.js';
import { sdkClient, type RevokeMandateInput, type WriteResult } from './sdk.js';
import { settledHash, type Settlement } from './settlement.js';
import { REVOKE, readTypedData, requireSamePayload } from './typed-data.js';

const SIGNER = 'principal' as const;

const REVOKE_ANCHOR: AnchorAction = 'revoke-mandate';

export interface RevokeSurface {
  typedData: BrickkenClient['getRevokeMandateTypedData'];
  settled: BrickkenClient['getTransactionStatus'];
  send: (input: RevokeMandateInput) => Promise<WriteResult>;
  chainNonce: () => Promise<bigint>;
  granted: (agent: AddressName) => Promise<boolean>;
  sign: (message: RevokeMandateMessage) => Promise<`0x${string}`>;
}

const SURFACE: RevokeSurface = {
  typedData: (query) => createBrickkenClient().getRevokeMandateTypedData(query),
  settled: (txId) => createBrickkenClient().getTransactionStatus(txId),
  send: (input) =>
    sdkClient(SIGNER).rams.revokeMandate(input, {
      execute: true,
      authorize: 'signature',
      signerAddress: requireAddress('principal'),
    }),
  chainNonce: async () => BigInt((await readRegistryState()).principalNonce),
  granted: async (agent) => {
    const state = await readRegistryState({ agent });
    return state.mandateGranted && !state.mandateRevoked;
  },
  sign: (message) => signTypedDataAs(SIGNER, revokeMandateTypedData(message)),
};

const revokeInput = (
  message: RevokeMandateMessage,
  signature: `0x${string}`,
): RevokeMandateInput => ({
  chainId: CHAIN_ID,
  agentMandateAddress: requireAddress('agentMandate'),
  agent: message.agent,
  principal: message.principal,
  deadline: String(message.deadline),
  signature,
});

export interface RevokeRun {
  surface?: RevokeSurface;
  spec?: MandateSpec;
  anchors?: string;
  file?: string;
  receipt?: (hash: `0x${string}`) => Promise<Receipt>;
}

/** Refuses unless a live mandate is there, so a no-op is never recorded as a revocation. */
export async function revokeMandate({
  surface = SURFACE,
  spec = KEEPER_MANDATE,
  anchors = ANCHOR_FILE,
  file = EVIDENCE_FILE,
  receipt = transactionReceipt,
}: RevokeRun = {}): Promise<Settlement> {
  if (!(await surface.granted(spec.agent)))
    throw new KeeperError('actionRefused', 'no live mandate is there to revoke');

  const nonce = await surface.chainNonce();
  const message = revokeMandateMessage({
    nowSeconds: Math.floor(Date.now() / 1000),
    nonce,
    agent: spec.agent,
  });
  const body = await surface.typedData({
    ...mandateQuery(spec),
    deadline: String(message.deadline),
  });
  requireSamePayload(message, grantMandateDomain(), readTypedData(body, REVOKE), REVOKE);

  const signature = await surface.sign(message);
  const result = await sdkWrite(file, 'ramsRevokeMandate', () =>
    surface.send(revokeInput(message, signature)),
  );
  if (result.sent === undefined)
    throw new KeeperError('writeUnconfirmed', 'the revocation prepared but never sent');

  const transactionHash = await settledHash(surface, result.txId);
  const { status } = await confirmAnchor(REVOKE_ANCHOR, transactionHash, {
    file: anchors,
    receipt,
  });
  if (status !== 'success')
    throw new KeeperError('writeUnconfirmed', `the revocation is ${status}`);
  return { txId: result.txId, transactionHash };
}
