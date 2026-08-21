import { fileURLToPath } from 'node:url';

import { CHAIN_ID, requireAddress } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { appendRecord } from '../shared/jsonl.js';
import { EXECUTOR_ARTIFACT, REGISTRY_ARTIFACT, compiledArtifact } from './artifacts.js';
import { blockNumber, readAddress, readValue, type Artifact } from './client.js';

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
  mandateGranted: boolean;
  mandateValidUntil: string;
  agentFrozen: boolean;
  principalNonce: string;
}

export interface RegistryChain {
  block: () => Promise<bigint>;
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

const CHAIN: RegistryChain = { block: blockNumber, read: readValue, readAddress };

export interface RegistryOptions {
  chain?: RegistryChain;
  file?: string;
  registry?: Artifact;
  executor?: Artifact;
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

function asWhole(value: unknown, what: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new KeeperError('readBackMismatch', `${what} is not a whole number`);
}

/** Every value is read at one block, so the record is a state and not a set of moments. */
export async function readRegistryState({
  chain = CHAIN,
  file = REGISTRY_READ_FILE,
  registry = compiledArtifact(REGISTRY_ARTIFACT),
  executor = compiledArtifact(EXECUTOR_ARTIFACT),
}: RegistryOptions = {}): Promise<RegistryRead> {
  const registryAddress = requireAddress('agentMandate');
  const executorAddress = requireAddress('executor');
  const principal = requireAddress('principal');
  const agent = requireAddress('agent');

  const named = await chain.readAddress(executorAddress, executor, 'principal');
  if (named.toLowerCase() !== principal.toLowerCase())
    throw new KeeperError('readBackMismatch', `the executor names ${named} as its principal`);

  const atBlock = await chain.block();
  const read = (functionName: string, args: readonly unknown[]): Promise<unknown> =>
    chain.read(registryAddress, registry, functionName, args, atBlock);

  const mandate = requireMandate(await read('getMandate', [agent, principal]));
  const frozen = asBoolean(await read('isFrozen', [agent]), 'isFrozen()');
  const nonce = asWhole(await read('nonces', [principal]), 'nonces()');

  const state: RegistryRead = {
    at: new Date().toISOString(),
    chainId: CHAIN_ID,
    registry: registryAddress,
    executor: executorAddress,
    principal,
    agent,
    blockNumber: String(atBlock),
    mandateGranted: asWhole(mandate['validUntil'], 'getMandate().validUntil') > 0n,
    mandateValidUntil: String(asWhole(mandate['validUntil'], 'getMandate().validUntil')),
    agentFrozen: frozen,
    principalNonce: String(nonce),
  };
  appendRecord(file, state);
  return state;
}
