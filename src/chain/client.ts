import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  type Abi,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

import { CHAIN_ID } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import {
  readOptionalSecret,
  readSecret,
  readSecretFile,
  scrubError,
  withoutSecrets,
  writeSecret,
} from '../shared/secrets.js';

/** The principal grants and revokes; the agent is msg.sender into the executor. */
export type SignerRole = 'principal' | 'agent';

const KEY_VARIABLE: Record<SignerRole, string> = {
  principal: 'PRINCIPAL_PRIVATE_KEY',
  agent: 'AGENT_PRIVATE_KEY',
};

const isPrivateKey = (value: string): value is `0x${string}` => /^0x[0-9a-fA-F]{64}$/.test(value);

/** A type error here means the config names a chain this client does not talk to. */
const chain = sepolia satisfies { id: typeof CHAIN_ID };

/** A provider URL embeds an API key, so it is a secret; reads fall back to the public endpoint. */
const transport = () => http(readOptionalSecret('SEPOLIA_RPC_URL'));

function accountFor(role: SignerRole) {
  const variable = KEY_VARIABLE[role];
  const key = readSecret(variable);
  if (!isPrivateKey(key))
    throw new KeeperError('secretMalformed', `${variable} is not 32 hex bytes`);
  try {
    return privateKeyToAccount(key);
  } catch (cause) {
    throw scrubError(cause);
  }
}

const buildReader = () => createPublicClient({ chain, transport: transport() });

const buildWallet = (role: SignerRole) =>
  createWalletClient({ account: accountFor(role), chain, transport: transport() });

const confirmedEndpoints = new Set<string>();

const PUBLIC_ENDPOINT = 'the public endpoint';

/** viem is told which chain it talks to and never asks, so a wrong URL would read as Sepolia. */
async function requireConfiguredChain(client: {
  getChainId: () => Promise<number>;
}): Promise<void> {
  const endpoint = readOptionalSecret('SEPOLIA_RPC_URL') ?? PUBLIC_ENDPOINT;
  if (confirmedEndpoints.has(endpoint)) return;
  const served = await client.getChainId();
  if (served !== CHAIN_ID) throw new KeeperError('wrongChain', `chain ${String(served)}`);
  confirmedEndpoints.add(endpoint);
}

/** A client is only handed out inside the scrubber, so no call site has to remember to redact. */
const withReader = <T>(use: (reader: ReturnType<typeof buildReader>) => Promise<T>): Promise<T> =>
  withoutSecrets(async () => {
    const reader = buildReader();
    await requireConfiguredChain(reader);
    return use(reader);
  });

const withWallet = <T>(
  role: SignerRole,
  use: (wallet: ReturnType<typeof buildWallet>) => Promise<T>,
): Promise<T> =>
  withoutSecrets(async () => {
    const wallet = buildWallet(role);
    await requireConfiguredChain(wallet);
    return use(wallet);
  });

export const signerAddress = (role: SignerRole): `0x${string}` => accountFor(role).address;

/** The key is written, read back off disk, and never returned, so only the address leaves here. */
export function createSignerKey(role: SignerRole): `0x${string}` {
  const variable = KEY_VARIABLE[role];
  const key = generatePrivateKey();
  writeSecret(variable, key);
  const stored = readSecretFile(variable);
  if (!isPrivateKey(stored) || stored !== key) throw new KeeperError('writeUnconfirmed', variable);
  return privateKeyToAccount(stored).address;
}

export async function blockNumber(): Promise<bigint> {
  return withReader((reader) => reader.getBlockNumber());
}

/** One transaction as Brickken prepares it. */
export interface OutboundTransaction {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  nonce: number;
  gas: bigint;
  chainId: number;
}

export type ConfirmationStatus = 'success' | 'reverted';

/** A compiled contract, as the Solidity compiler emits it. Never written by hand. */
export interface Artifact {
  abi: Abi;
  bytecode: `0x${string}`;
}

export interface Receipt {
  status: ConfirmationStatus;
  blockNumber: bigint;
  contractAddress: `0x${string}` | null;
}

export async function sendTransaction(
  role: SignerRole,
  transaction: OutboundTransaction,
): Promise<`0x${string}`> {
  const { to, data, value, nonce, gas } = transaction;
  return withWallet(role, (wallet) => wallet.sendTransaction({ to, data, value, nonce, gas }));
}

export async function transactionReceipt(hash: `0x${string}`): Promise<Receipt> {
  const { status, blockNumber, contractAddress } = await withReader((reader) =>
    reader.waitForTransactionReceipt({ hash }),
  );
  return { status, blockNumber, contractAddress: contractAddress ?? null };
}

export async function confirmTransaction(hash: `0x${string}`): Promise<ConfirmationStatus> {
  const { status } = await transactionReceipt(hash);
  return status;
}

export async function deployContract(
  role: SignerRole,
  artifact: Artifact,
  args: readonly unknown[],
): Promise<`0x${string}`> {
  const { abi, bytecode } = artifact;
  return withWallet(role, (wallet) => wallet.deployContract({ abi, bytecode, args }));
}

export async function writeContract(
  role: SignerRole,
  contract: `0x${string}`,
  artifact: Artifact,
  functionName: string,
  args: readonly unknown[],
): Promise<`0x${string}`> {
  return withWallet(role, (wallet) =>
    wallet.writeContract({ address: contract, abi: artifact.abi, functionName, args }),
  );
}

/** How the executor reads the gated amount out of one selector's calldata. */
export interface ActionSpec {
  supported: boolean;
  hasAmount: boolean;
  amountIndex: number;
}

export async function readAction(
  contract: `0x${string}`,
  artifact: Artifact,
  selector: `0x${string}`,
): Promise<ActionSpec> {
  const value = await withReader((reader) =>
    reader.readContract({
      address: contract,
      abi: artifact.abi,
      functionName: 'actions',
      args: [selector],
    }),
  );
  if (!Array.isArray(value) || value.length !== 3)
    throw new KeeperError('readBackMismatch', 'actions() did not return an action');
  const [supported, hasAmount, amountIndex] = value as unknown[];
  if (
    typeof supported !== 'boolean' ||
    typeof hasAmount !== 'boolean' ||
    typeof amountIndex !== 'number'
  )
    throw new KeeperError('readBackMismatch', 'actions() returned fields of another shape');
  return { supported, hasAmount, amountIndex };
}

/** Reads a no-argument getter and refuses anything that is not an address. */
export async function readAddress(
  contract: `0x${string}`,
  artifact: Artifact,
  functionName: string,
): Promise<`0x${string}`> {
  const value = await withReader((reader) =>
    reader.readContract({ address: contract, abi: artifact.abi, functionName }),
  );
  if (typeof value !== 'string' || !isAddress(value))
    throw new KeeperError('readBackMismatch', `${functionName}() did not return an address`);
  return getAddress(value);
}
