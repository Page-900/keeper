import { fileURLToPath } from 'node:url';

import {
  CHAIN_ID,
  PROBE_MANDATE,
  identityRef,
  requireAddress,
  type AddressName,
} from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { appendRecord, readRecords } from '../shared/jsonl.js';
import { confirmAnchor } from './anchors.js';
import { MANDATE_ERRORS_ARTIFACT, compiledArtifact } from './artifacts.js';
import {
  bytesDigest,
  signTypedDataAs,
  simulateRefusal,
  transactionArguments,
  writeContract,
  writeWithGasLimit,
  type RevertReason,
} from './client.js';
import {
  grantMandateMessage,
  grantMandateTypedData,
  revokeMandateMessage,
  revokeMandateTypedData,
  type GrantMandateMessage,
  type RevokeMandateMessage,
} from './mandate.js';
import { readRegistryState, type RegistryRead } from './registry.js';

/** Resolved from this module, so the file cannot follow the working directory. */
export const SIGNATURE_FILE = fileURLToPath(
  new URL('../../evidence/signatures.jsonl', import.meta.url),
);

export const REVOKE_CASE = 'revoke';

/** _verifySignature checks the deadline before the digest, so a late replay becomes D1 instead. */
export const REFUSALS = {
  R1: 'InvalidSignature',
  D1: 'SignatureExpired',
  X4: 'MandateAlreadyActive',
} as const;

const PAST_DEADLINE_SECONDS = -300n;

/** A call meant to revert cannot be gas estimated, because the estimate is the revert. */
const GAS_LIMIT = 200_000n;

export interface SignedCall {
  functionName: 'revokeMandate' | 'grantMandate';
  args: readonly unknown[];
  agent: `0x${string}`;
  deadline: bigint;
  signature: `0x${string}`;
}

export const revokeCall = (
  message: RevokeMandateMessage,
  signature: `0x${string}`,
): SignedCall => ({
  functionName: 'revokeMandate',
  args: [message.agent, message.principal, message.deadline, signature],
  agent: message.agent,
  deadline: message.deadline,
  signature,
});

export const grantCall = (message: GrantMandateMessage, signature: `0x${string}`): SignedCall => ({
  functionName: 'grantMandate',
  args: [
    {
      agent: message.agent,
      validFrom: message.validFrom,
      validUntil: message.validUntil,
      principal: message.principal,
      complianceProvider: message.complianceProvider,
      identityRef: message.identityRef,
      asset: message.asset,
      maxTransactionValue: message.maxTransactionValue,
      maxCumulativeValue: message.maxCumulativeValue,
      metadata: message.metadata,
      actions: message.actions,
      deadline: message.deadline,
    },
    signature,
  ],
  agent: message.agent,
  deadline: message.deadline,
  signature,
});

export interface SignatureRecord {
  at: string;
  chainId: number;
  case: string;
  refused: boolean;
  expect: string | null;
  revert: RevertReason | null;
  agent: `0x${string}`;
  nonceSigned: string;
  nonceBefore: string;
  deadline: string;
  clockBefore: string;
  blockNumber: string;
  transactionHash: `0x${string}`;
  /** The bytes themselves live in the transaction this hash names, and are read back from it. */
  signatureDigest: `0x${string}`;
}

export interface SignatureChain {
  state: (agent: AddressName) => Promise<RegistryRead>;
  sign: (message: RevokeMandateMessage) => Promise<`0x${string}`>;
  signGrant: (message: GrantMandateMessage) => Promise<`0x${string}`>;
  simulate: (call: SignedCall) => Promise<RevertReason | null>;
  spent: (hash: `0x${string}`) => Promise<SignedCall>;
  send: (call: SignedCall, refused: boolean) => Promise<`0x${string}`>;
  confirm: (name: string, hash: `0x${string}`) => Promise<{ status: string; blockNumber: string }>;
}

const registry = () => compiledArtifact(MANDATE_ERRORS_ARTIFACT);

export const CHAIN: SignatureChain = {
  state: (agent) => readRegistryState({ agent }),
  sign: (message) => signTypedDataAs('principal', revokeMandateTypedData(message)),
  signGrant: (message) => signTypedDataAs('principal', grantMandateTypedData(message)),
  simulate: (call) =>
    simulateRefusal(
      'principal',
      requireAddress('agentMandate'),
      registry(),
      call.functionName,
      call.args,
    ),
  send: (call, refused) =>
    refused
      ? writeWithGasLimit(
          'principal',
          requireAddress('agentMandate'),
          registry(),
          call.functionName,
          call.args,
          GAS_LIMIT,
        )
      : writeContract(
          'principal',
          requireAddress('agentMandate'),
          registry(),
          call.functionName,
          call.args,
        ),
  confirm: async (name, hash) => {
    const anchor = await confirmAnchor(`signature-${name}`, hash);
    return { status: anchor.status, blockNumber: anchor.blockNumber };
  },
  spent: async (hash) => {
    const [agent, principal, deadline, signature] = (await transactionArguments(
      hash,
      registry(),
    )) as [`0x${string}`, `0x${string}`, bigint, `0x${string}`];
    return revokeCall({ agent, principal, nonce: 0n, deadline }, signature);
  },
};

export const alreadyRun = (name: string, file: string = SIGNATURE_FILE): boolean =>
  readRecords<SignatureRecord>(file).some((record) => record.case === name);

/** The bytes R1 replays are the ones a revoke really spent, read back rather than rebuilt. */
export function usedRevoke(file: string = SIGNATURE_FILE): SignatureRecord {
  const record = readRecords<SignatureRecord>(file).find(
    (found) => found.case === REVOKE_CASE && !found.refused,
  );
  if (record === undefined)
    throw new KeeperError('refusalUnattributable', 'no spent revoke signature is recorded');
  return record;
}

export interface SignatureRun {
  chain: SignatureChain;
  agent: AddressName;
  file?: string;
}

interface Attempt {
  name: string;
  expect: string | null;
  call: SignedCall;
  nonceSigned: bigint;
}

async function submit(attempt: Attempt, run: SignatureRun): Promise<SignatureRecord> {
  const file = run.file ?? SIGNATURE_FILE;
  if (alreadyRun(attempt.name, file))
    throw new KeeperError('alreadyCreated', `${attempt.name} is already recorded`);

  const refused = attempt.expect !== null;
  const state = await run.chain.state(run.agent);
  const revert = await run.chain.simulate(attempt.call);
  if (refused ? revert?.error !== attempt.expect : revert !== null)
    throw new KeeperError(
      'refusalUnattributable',
      `${attempt.name} simulates ${revert === null ? 'clean' : revert.error}`,
    );

  const transactionHash = await run.chain.send(attempt.call, refused);
  const receipt = await run.chain.confirm(attempt.name, transactionHash);
  const wanted = refused ? 'reverted' : 'success';
  if (receipt.status !== wanted)
    throw new KeeperError(
      'writeUnconfirmed',
      `${attempt.name} is ${receipt.status} and not ${wanted}`,
    );

  const record: SignatureRecord = {
    at: new Date().toISOString(),
    chainId: CHAIN_ID,
    case: attempt.name,
    refused,
    expect: attempt.expect,
    revert,
    agent: attempt.call.agent,
    nonceSigned: String(attempt.nonceSigned),
    nonceBefore: state.principalNonce,
    deadline: String(attempt.call.deadline),
    clockBefore: state.blockTimestamp,
    blockNumber: receipt.blockNumber,
    transactionHash,
    signatureDigest: bytesDigest(attempt.call.signature),
  };
  appendRecord(file, record);
  return record;
}

async function signRevoke(
  run: SignatureRun,
  deadlineSeconds?: bigint,
): Promise<{ call: SignedCall; nonce: bigint }> {
  const state = await run.chain.state(run.agent);
  const nonce = BigInt(state.principalNonce);
  const message = revokeMandateMessage({
    nowSeconds: Number(state.blockTimestamp),
    nonce,
    agent: run.agent,
    ...(deadlineSeconds === undefined ? {} : { deadlineSeconds }),
  });
  return { call: revokeCall(message, await run.chain.sign(message)), nonce };
}

export async function runRevoke(run: SignatureRun): Promise<SignatureRecord> {
  const { call, nonce } = await signRevoke(run);
  return submit({ name: REVOKE_CASE, expect: null, call, nonceSigned: nonce }, run);
}

/** A deadline the block has already passed is refused before the digest is ever computed. */
export async function runExpiredDeadline(run: SignatureRun): Promise<SignatureRecord> {
  const { call, nonce } = await signRevoke(run, PAST_DEADLINE_SECONDS);
  const state = await run.chain.state(run.agent);
  if (call.deadline >= BigInt(state.blockTimestamp))
    throw new KeeperError(
      'refusalUnattributable',
      `D1 carries a deadline of ${String(call.deadline)} and the block reads ${state.blockTimestamp}`,
    );
  return submit({ name: 'D1', expect: REFUSALS.D1, call, nonceSigned: nonce }, run);
}

/** A grant replay never reaches the signature check, so the replayed one has to be a revoke. */
export async function runReplay(run: SignatureRun): Promise<SignatureRecord> {
  const spent = usedRevoke(run.file);
  const state = await run.chain.state(run.agent);
  if (state.principalNonce === spent.nonceSigned)
    throw new KeeperError(
      'refusalUnattributable',
      `the replay number is still ${spent.nonceSigned}, so nothing was replayed`,
    );
  if (BigInt(spent.deadline) <= BigInt(state.blockTimestamp))
    throw new KeeperError(
      'refusalUnattributable',
      `the spent signature expired at ${spent.deadline} and the block reads ${state.blockTimestamp}, which proves the deadline and not the replay`,
    );

  const call = await run.chain.spent(spent.transactionHash);
  if (bytesDigest(call.signature) !== spent.signatureDigest)
    throw new KeeperError(
      'refusalUnattributable',
      'the transaction named by the spent revoke does not carry the signature it recorded',
    );

  return submit(
    { name: 'R1', expect: REFUSALS.R1, call, nonceSigned: BigInt(spent.nonceSigned) },
    run,
  );
}

/** The duplicate check runs before the signature is looked at, so this proves nothing about one. */
export async function runDuplicateGrant(run: SignatureRun): Promise<SignatureRecord> {
  const state = await run.chain.state(run.agent);
  if (state.mandateRevoked || BigInt(state.blockTimestamp) > BigInt(state.mandateValidUntil))
    throw new KeeperError(
      'refusalUnattributable',
      `the mandate this would duplicate is ${state.mandateRevoked ? 'revoked' : 'expired'}, so a second grant would be accepted`,
    );

  const nonce = BigInt(state.principalNonce);
  const message = grantMandateMessage({
    nowSeconds: Number(state.blockTimestamp),
    nonce,
    identityRef,
    spec: PROBE_MANDATE,
  });
  const call = grantCall(message, await run.chain.signGrant(message));
  return submit({ name: 'X4', expect: REFUSALS.X4, call, nonceSigned: nonce }, run);
}
