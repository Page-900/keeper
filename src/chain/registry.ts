import { fileURLToPath } from 'node:url';

import {
  CHAIN_ID,
  RECORDER_ROLE,
  TRANSFER_ACTION,
  identityRef,
  requireAddress,
  type AddressName,
} from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { appendRecord } from '../shared/jsonl.js';
import {
  COMPLIANCE_ARTIFACT,
  EXECUTOR_ARTIFACT,
  REGISTRY_ARTIFACT,
  ROLES_ARTIFACT,
  compiledArtifact,
} from './artifacts.js';
import { blockNumber, blockTimestamp, readAddress, readValue, type Artifact } from './client.js';

/** Resolved from this module, so the file cannot follow the working directory. */
export const REGISTRY_READ_FILE = fileURLToPath(
  new URL('../../evidence/registry-reads.jsonl', import.meta.url),
);

/** The order the grant, the caps, and every allowance read are decoded in. */
export const MANDATE_FIELDS = [
  'agent',
  'validFrom',
  'validUntil',
  'principal',
  'revoked',
  'complianceProvider',
  'identityRef',
  'asset',
  'maxTransactionValue',
  'maxCumulativeValue',
  'cumulativeUsed',
  'metadata',
] as const;

export interface RegistryRead {
  at: string;
  chainId: number;
  registry: `0x${string}`;
  executor: `0x${string}`;
  principal: `0x${string}`;
  agent: `0x${string}`;
  blockNumber: string;
  blockTimestamp: string;
  mandateGranted: boolean;
  mandateValidFrom: string;
  mandateValidUntil: string;
  mandateAgent: `0x${string}`;
  mandatePrincipal: `0x${string}`;
  mandateAsset: `0x${string}`;
  mandateRevoked: boolean;
  maxTransactionValue: string;
  maxCumulativeValue: string;
  cumulativeUsed: string;
  actionEnabled: boolean;
  agentFrozen: boolean;
  principalNonce: string;
  principalEligible: boolean;
  eligibilityReason: number;
  eligibilityExpiresAt: string;
  executorMayRecord: boolean;
}

export interface RegistryChain {
  block: () => Promise<bigint>;
  timestamp: (atBlock: bigint) => Promise<bigint>;
  read: (
    contract: `0x${string}`,
    artifact: Artifact,
    functionName: string,
    args: readonly unknown[],
    atBlock: bigint,
  ) => Promise<unknown>;
  readAddress: (
    contract: `0x${string}`,
    artifact: Artifact,
    functionName: string,
  ) => Promise<`0x${string}`>;
}

const CHAIN: RegistryChain = {
  block: blockNumber,
  timestamp: blockTimestamp,
  read: readValue,
  readAddress,
};

export interface RegistryOptions {
  chain?: RegistryChain;
  file?: string;
  agent?: AddressName;
  action?: `0x${string}`;
  registry?: Artifact;
  executor?: Artifact;
  roles?: Artifact;
  compliance?: Artifact;
}

export interface Eligibility {
  eligible: boolean;
  reason: number;
  expiresAt: bigint;
}

function requireMandate(value: unknown): Record<string, unknown> {
  const missing =
    typeof value === 'object' && value !== null
      ? MANDATE_FIELDS.filter((field) => !(field in value))
      : [...MANDATE_FIELDS];
  if (missing.length > 0)
    throw new KeeperError('readBackMismatch', `getMandate() has no ${missing.join(', ')}`);
  return value as Record<string, unknown>;
}

function asBoolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean')
    throw new KeeperError('readBackMismatch', `${what} is not true or false`);
  return value;
}

function asAddress(value: unknown, what: string): `0x${string}` {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new KeeperError('readBackMismatch', `${what} is not an address`);
  return value as `0x${string}`;
}

function asWhole(value: unknown, what: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new KeeperError('readBackMismatch', `${what} is not a whole number`);
}

function requireEligibility(value: unknown): Eligibility {
  if (!Array.isArray(value) || value.length !== 3)
    throw new KeeperError('readBackMismatch', 'checkPrincipal() answered no eligibility');
  const [eligible, reason, expiresAt] = value as unknown[];
  return {
    eligible: asBoolean(eligible, 'checkPrincipal() eligible'),
    reason: Number(asWhole(reason, 'checkPrincipal() reason')),
    expiresAt: asWhole(expiresAt, 'checkPrincipal() expiresAt'),
  };
}

export interface ExecuteQuery {
  agent: `0x${string}`;
  principal: `0x${string}`;
  asset: `0x${string}`;
  action: `0x${string}`;
  amount: bigint;
  atBlock: bigint;
}

/** The one place canExecute is asked, so the refusal path and the battery cannot drift apart. */
export async function readCanExecute(
  query: ExecuteQuery,
  registry: Artifact = compiledArtifact(REGISTRY_ARTIFACT),
): Promise<boolean> {
  const answer = await readValue(
    requireAddress('agentMandate'),
    registry,
    'canExecute',
    [query.agent, query.principal, query.asset, query.action, query.amount],
    query.atBlock,
  );
  if (typeof answer !== 'boolean')
    throw new KeeperError('readBackMismatch', 'canExecute() did not answer true or false');
  return answer;
}

/** Every value is read at one block, so the record is a state and not a set of moments. */
export async function readRegistryState({
  chain = CHAIN,
  file = REGISTRY_READ_FILE,
  registry = compiledArtifact(REGISTRY_ARTIFACT),
  executor = compiledArtifact(EXECUTOR_ARTIFACT),
  roles = compiledArtifact(ROLES_ARTIFACT),
  compliance = compiledArtifact(COMPLIANCE_ARTIFACT),
  agent: agentName = 'agent',
  action = TRANSFER_ACTION,
}: RegistryOptions = {}): Promise<RegistryRead> {
  const registryAddress = requireAddress('agentMandate');
  const executorAddress = requireAddress('executor');
  const complianceAddress = requireAddress('complianceProvider');
  const principal = requireAddress('principal');
  const agent = requireAddress(agentName);

  const named = await chain.readAddress(executorAddress, executor, 'principal');
  if (named.toLowerCase() !== principal.toLowerCase())
    throw new KeeperError('readBackMismatch', `the executor names ${named} as its principal`);

  const atBlock = await chain.block();
  const read = (functionName: string, args: readonly unknown[]): Promise<unknown> =>
    chain.read(registryAddress, registry, functionName, args, atBlock);

  const mandate = requireMandate(await read('getMandate', [agent, principal]));
  const frozen = asBoolean(await read('isFrozen', [agent]), 'isFrozen()');
  const nonce = asWhole(await read('nonces', [principal]), 'nonces()');
  const eligibility = requireEligibility(
    await chain.read(
      complianceAddress,
      compliance,
      'checkPrincipal',
      [principal, identityRef],
      atBlock,
    ),
  );
  const actionEnabled = asBoolean(
    await read('isActionEnabled', [agent, principal, action]),
    'isActionEnabled()',
  );
  const mayRecord = asBoolean(
    await chain.read(registryAddress, roles, 'hasRole', [RECORDER_ROLE, executorAddress], atBlock),
    'hasRole()',
  );

  const state: RegistryRead = {
    at: new Date().toISOString(),
    chainId: CHAIN_ID,
    registry: registryAddress,
    executor: executorAddress,
    principal,
    agent,
    blockNumber: String(atBlock),
    blockTimestamp: String(await chain.timestamp(atBlock)),
    mandateGranted: asWhole(mandate['validUntil'], 'getMandate().validUntil') > 0n,
    mandateValidFrom: String(asWhole(mandate['validFrom'], 'getMandate().validFrom')),
    mandateValidUntil: String(asWhole(mandate['validUntil'], 'getMandate().validUntil')),
    mandateAgent: asAddress(mandate['agent'], 'getMandate().agent'),
    mandatePrincipal: asAddress(mandate['principal'], 'getMandate().principal'),
    mandateAsset: asAddress(mandate['asset'], 'getMandate().asset'),
    mandateRevoked: asBoolean(mandate['revoked'], 'getMandate().revoked'),
    maxTransactionValue: String(asWhole(mandate['maxTransactionValue'], 'the per-transfer cap')),
    maxCumulativeValue: String(asWhole(mandate['maxCumulativeValue'], 'the total cap')),
    cumulativeUsed: String(asWhole(mandate['cumulativeUsed'], 'the running total')),
    actionEnabled,
    agentFrozen: frozen,
    principalNonce: String(nonce),
    principalEligible: eligibility.eligible,
    eligibilityReason: eligibility.reason,
    eligibilityExpiresAt: String(eligibility.expiresAt),
    executorMayRecord: mayRecord,
  };
  appendRecord(file, state);
  return state;
}
