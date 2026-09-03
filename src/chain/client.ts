import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  keccak256,
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

/** The principal grants authority, the agent spends it, the counterparty only receives. */
export type SignerRole = 'principal' | 'agent' | 'counterparty' | 'probe' | 'uncleared';

const KEY_VARIABLE: Record<SignerRole, string> = {
  principal: 'PRINCIPAL_PRIVATE_KEY',
  agent: 'AGENT_PRIVATE_KEY',
  counterparty: 'COUNTERPARTY_PRIVATE_KEY',
  probe: 'PROBE_PRIVATE_KEY',
  uncleared: 'UNCLEARED_PRIVATE_KEY',
};

export const SIGNER_ROLES = Object.keys(KEY_VARIABLE) as readonly SignerRole[];

const isPrivateKey = (value: string): value is `0x${string}` => /^0x[0-9a-fA-F]{64}$/.test(value);

/** A type error here means the config names a chain this client does not talk to. */
const chain = sepolia satisfies { id: typeof CHAIN_ID };

/** A provider URL embeds an API key, so it is a secret; reads fall back to the public endpoint. */
const transport = () => http(readOptionalSecret('SEPOLIA_RPC_URL'));

export function signerKey(role: SignerRole): `0x${string}` {
  const variable = KEY_VARIABLE[role];
  const key = readSecret(variable);
  if (!isPrivateKey(key))
    throw new KeeperError('secretMalformed', `${variable} is not 32 hex bytes`);
  return key;
}

function signerAccount(role: SignerRole) {
  try {
    return privateKeyToAccount(signerKey(role));
  } catch (cause) {
    throw scrubError(cause);
  }
}

const buildReader = () => createPublicClient({ chain, transport: transport() });

const buildWallet = (role: SignerRole) =>
  createWalletClient({ account: signerAccount(role), chain, transport: transport() });

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

export const signerAddress = (role: SignerRole): `0x${string}` => signerAccount(role).address;

/** The key is written, read back off disk, and never returned, so only the address leaves here. */
export function createSignerKey(role: SignerRole): `0x${string}` {
  const variable = KEY_VARIABLE[role];
  const key = generatePrivateKey();
  writeSecret(variable, key);
  const stored = readSecretFile(variable);
  if (!isPrivateKey(stored) || stored !== key) throw new KeeperError('writeUnconfirmed', variable);
  return privateKeyToAccount(stored).address;
}

export interface TypedDataRequest {
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

export async function signTypedDataAs(
  role: SignerRole,
  request: TypedDataRequest,
): Promise<`0x${string}`> {
  return withWallet(role, (wallet) =>
    wallet.signTypedData(request as Parameters<typeof wallet.signTypedData>[0]),
  );
}

export async function blockNumber(): Promise<bigint> {
  return withReader((reader) => reader.getBlockNumber());
}

export async function blockTimestamp(atBlock: bigint): Promise<bigint> {
  return withReader(async (reader) => (await reader.getBlock({ blockNumber: atBlock })).timestamp);
}

export type ConfirmationStatus = 'success' | 'reverted';

export interface Artifact {
  abi: Abi;
  bytecode: `0x${string}`;
}

export interface Receipt {
  status: ConfirmationStatus;
  blockNumber: bigint;
  contractAddress: `0x${string}` | null;
  gasUsed: bigint;
}

export async function sendDirect(
  role: SignerRole,
  to: `0x${string}`,
  value: bigint,
  data: `0x${string}` = '0x',
): Promise<`0x${string}`> {
  return withWallet(role, (wallet) => wallet.sendTransaction({ to, value, data }));
}

export async function readEtherBalance(holder: `0x${string}`): Promise<bigint> {
  return withReader((reader) => reader.getBalance({ address: holder }));
}

export async function transactionReceipt(hash: `0x${string}`): Promise<Receipt> {
  const { status, blockNumber, contractAddress, gasUsed } = await withReader((reader) =>
    reader.waitForTransactionReceipt({ hash }),
  );
  return { status, blockNumber, contractAddress: contractAddress ?? null, gasUsed };
}

export async function transactionArguments(
  hash: `0x${string}`,
  artifact: Artifact,
): Promise<readonly unknown[]> {
  const data = await withReader(async (reader) => (await reader.getTransaction({ hash })).input);
  return decodeFunctionData({ abi: artifact.abi, data }).args ?? [];
}

export const bytesDigest = (bytes: `0x${string}`): `0x${string}` => keccak256(bytes);

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

/** Given a gas limit, viem skips the estimate, which is the only way a revert can be sent. */
export async function writeWithGasLimit(
  role: SignerRole,
  contract: `0x${string}`,
  artifact: Artifact,
  functionName: string,
  args: readonly unknown[],
  gas: bigint,
): Promise<`0x${string}`> {
  return withWallet(role, (wallet) =>
    wallet.writeContract({ address: contract, abi: artifact.abi, functionName, args, gas }),
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

export interface RevertReason {
  error: string;
  args: string[];
}

/** The scrubber flattens viem's error, so the custom error is decoded before it escapes. */
export function revertReason(cause: unknown): RevertReason {
  const reverted =
    cause instanceof BaseError
      ? cause.walk((error) => error instanceof ContractFunctionRevertedError)
      : null;
  if (!(reverted instanceof ContractFunctionRevertedError) || reverted.data === undefined)
    throw scrubError(cause);
  return { error: reverted.data.errorName, args: (reverted.data.args ?? []).map(String) };
}

export async function simulateRefusalAs(
  caller: `0x${string}`,
  contract: `0x${string}`,
  artifact: Artifact,
  functionName: string,
  args: readonly unknown[],
  atBlock?: bigint,
): Promise<RevertReason | null> {
  return withReader(async (reader) => {
    try {
      await reader.simulateContract({
        address: contract,
        abi: artifact.abi,
        functionName,
        args,
        account: caller,
        ...(atBlock === undefined ? {} : { blockNumber: atBlock }),
      });
      return null;
    } catch (cause) {
      return revertReason(cause);
    }
  });
}

export async function simulateRefusal(
  role: SignerRole,
  contract: `0x${string}`,
  artifact: Artifact,
  functionName: string,
  args: readonly unknown[],
  atBlock?: bigint,
): Promise<RevertReason | null> {
  return simulateRefusalAs(signerAddress(role), contract, artifact, functionName, args, atBlock);
}

export async function simulateCall(
  role: SignerRole,
  contract: `0x${string}`,
  artifact: Artifact,
  functionName: string,
  args: readonly unknown[],
): Promise<void> {
  const refused = await simulateRefusal(role, contract, artifact, functionName, args);
  if (refused !== null)
    throw new KeeperError(
      'actionRefused',
      `${functionName} would revert with ${refused.error}(${refused.args.join(', ')})`,
    );
}

export async function readValue(
  contract: `0x${string}`,
  artifact: Artifact,
  functionName: string,
  args: readonly unknown[],
  atBlock: bigint,
): Promise<unknown> {
  return withReader((reader) =>
    reader.readContract({
      address: contract,
      abi: artifact.abi,
      functionName,
      args,
      blockNumber: atBlock,
    }),
  );
}

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

export interface TokenIdentity {
  symbol: string;
  decimals: number;
}

export async function readTokenIdentity(contract: `0x${string}`): Promise<TokenIdentity> {
  return withReader(async (reader) => {
    const token = { address: contract, abi: erc20Abi } as const;
    const [symbol, decimals] = await Promise.all([
      reader.readContract({ ...token, functionName: 'symbol' }),
      reader.readContract({ ...token, functionName: 'decimals' }),
    ]);
    return { symbol, decimals };
  });
}

export async function readTokenBalance(
  contract: `0x${string}`,
  holder: `0x${string}`,
  atBlock?: bigint,
): Promise<bigint> {
  return withReader((reader) =>
    reader.readContract({
      address: contract,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [holder],
      ...(atBlock === undefined ? {} : { blockNumber: atBlock }),
    }),
  );
}

export interface SimulatedCall {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
}

export interface HoldingChange {
  before: bigint;
  after: bigint;
  ran: boolean;
}

const balanceRead = (token: `0x${string}`, holder: `0x${string}`): SimulatedCall => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [holder] }),
  value: 0n,
});

const balanceFrom = (data: `0x${string}`): bigint =>
  decodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', data });

export async function simulateHolding(
  token: `0x${string}`,
  holder: `0x${string}`,
  calls: readonly SimulatedCall[],
): Promise<HoldingChange> {
  const read = balanceRead(token, holder);
  const results = await withReader(async (reader) => {
    const simulated = await reader.simulateCalls({
      account: holder,
      calls: [read, ...calls, read],
    });
    return simulated.results;
  });
  const first = results.at(0);
  const last = results.at(-1);
  if (first?.status !== 'success' || last?.status !== 'success')
    throw new KeeperError('readBackMismatch', 'the simulation did not read the balance');
  return {
    before: balanceFrom(first.data),
    after: balanceFrom(last.data),
    ran: results.slice(1, -1).every((result) => result.status === 'success'),
  };
}

export async function readTokenSupply(contract: `0x${string}`, atBlock: bigint): Promise<bigint> {
  return withReader((reader) =>
    reader.readContract({
      address: contract,
      abi: erc20Abi,
      functionName: 'totalSupply',
      blockNumber: atBlock,
    }),
  );
}

/** The only transferFrom calldata this project builds, so no caller hand-rolls a selector. */
export const transferFromCalldata = (
  from: `0x${string}`,
  to: `0x${string}`,
  amount: bigint,
): `0x${string}` =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'transferFrom', args: [from, to, amount] });

export const approveCalldata = (spender: `0x${string}`, amount: bigint): `0x${string}` =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] });

export const transferToCalldata = (to: `0x${string}`, amount: bigint): `0x${string}` =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amount] });

export async function readTokenAllowance(
  contract: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`,
): Promise<bigint> {
  return withReader((reader) =>
    reader.readContract({
      address: contract,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [owner, spender],
    }),
  );
}
