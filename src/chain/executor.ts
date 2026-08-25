import { PERMITTED_ACTION, requireAddress } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { readRecords } from '../shared/jsonl.js';
import { ANCHOR_FILE, recordAnchor, type Anchor, type AnchorAction } from './anchors.js';
import { EXECUTOR_ARTIFACT, compiledArtifact } from './artifacts.js';
import {
  deployContract,
  readAction,
  readAddress,
  signerAddress,
  transactionReceipt,
  writeContract,
  type ActionSpec,
  type Artifact,
  type Receipt,
  type SignerRole,
} from './client.js';

const OWNER: SignerRole = 'principal';
const DEPLOY: AnchorAction = 'deploy-executor';
const REGISTER: AnchorAction = 'register-action';

export interface ExecutorChain {
  deploy: (
    role: SignerRole,
    artifact: Artifact,
    args: readonly unknown[],
  ) => Promise<`0x${string}`>;
  receipt: (hash: `0x${string}`) => Promise<Receipt>;
  readAddress: (
    contract: `0x${string}`,
    artifact: Artifact,
    functionName: string,
  ) => Promise<`0x${string}`>;
  deployer: () => `0x${string}`;
}

const CHAIN: ExecutorChain = {
  deploy: deployContract,
  receipt: transactionReceipt,
  readAddress,
  deployer: () => signerAddress(OWNER),
};

export interface Deployment {
  address: `0x${string}`;
  transactionHash: `0x${string}`;
  blockNumber: string;
}

export interface DeployOptions {
  chain?: ExecutorChain;
  file?: string;
  artifact?: Artifact;
}

const sameAddress = (found: string, intended: string): boolean =>
  found.toLowerCase() === intended.toLowerCase();

async function confirmConstructorArguments(
  chain: ExecutorChain,
  artifact: Artifact,
  contract: `0x${string}`,
  intended: Record<string, `0x${string}`>,
): Promise<void> {
  for (const [functionName, expected] of Object.entries(intended)) {
    const found = await chain.readAddress(contract, artifact, functionName);
    if (!sameAddress(found, expected))
      throw new KeeperError('readBackMismatch', `${functionName}() reads ${found}`);
  }
}

/** The executor owner is the principal and never the agent: setAction is onlyOwner. */
export async function deployExecutor({
  chain = CHAIN,
  file = ANCHOR_FILE,
  artifact = compiledArtifact(EXECUTOR_ARTIFACT),
}: DeployOptions = {}): Promise<Deployment> {
  const already = readRecords<Anchor>(file).find(
    (anchor) => anchor.action === DEPLOY && anchor.status === 'success',
  );
  if (already !== undefined)
    throw new KeeperError(
      'alreadyDeployed',
      `${already.contract ?? 'an executor'} already holds it`,
    );

  const registry = requireAddress('agentMandate');
  const principal = chain.deployer();
  const transactionHash = await chain.deploy(OWNER, artifact, [registry, principal, principal]);
  const { status, blockNumber, contractAddress, gasUsed } = await chain.receipt(transactionHash);
  recordAnchor(file, {
    action: DEPLOY,
    transactionHash,
    blockNumber: String(blockNumber),
    status,
    contract: contractAddress,
    gasUsed: String(gasUsed),
  });

  if (status !== 'success' || contractAddress === null)
    throw new KeeperError('writeUnconfirmed', `the deploy is ${status}`);

  await confirmConstructorArguments(chain, artifact, contractAddress, {
    rams: registry,
    principal,
    owner: principal,
  });
  return { address: contractAddress, transactionHash, blockNumber: String(blockNumber) };
}

export interface ActionChain {
  write: (
    role: SignerRole,
    contract: `0x${string}`,
    artifact: Artifact,
    functionName: string,
    args: readonly unknown[],
  ) => Promise<`0x${string}`>;
  receipt: (hash: `0x${string}`) => Promise<Receipt>;
  readAction: (
    contract: `0x${string}`,
    artifact: Artifact,
    selector: `0x${string}`,
  ) => Promise<ActionSpec>;
}

const ACTION_CHAIN: ActionChain = {
  write: writeContract,
  receipt: transactionReceipt,
  readAction,
};

export interface Registration {
  transactionHash: `0x${string}`;
  blockNumber: string;
  spec: ActionSpec;
}

export interface RegisterOptions {
  chain?: ActionChain;
  file?: string;
  artifact?: Artifact;
}

const { selector, supported, hasAmount, amountIndex } = PERMITTED_ACTION;

const INTENDED: ActionSpec = { supported, hasAmount, amountIndex };

/** A wrong amountIndex gates the cap on the wrong word, so all three are read back. */
function confirmAction(found: ActionSpec): void {
  for (const field of Object.keys(INTENDED) as (keyof ActionSpec)[]) {
    if (found[field] !== INTENDED[field])
      throw new KeeperError('readBackMismatch', `actions().${field} reads ${String(found[field])}`);
  }
}

export async function registerAction({
  chain = ACTION_CHAIN,
  file = ANCHOR_FILE,
  artifact = compiledArtifact(EXECUTOR_ARTIFACT),
}: RegisterOptions = {}): Promise<Registration> {
  const executor = requireAddress('executor');
  const transactionHash = await chain.write(OWNER, executor, artifact, 'setAction', [
    selector,
    supported,
    hasAmount,
    amountIndex,
  ]);
  const { status, blockNumber, gasUsed } = await chain.receipt(transactionHash);
  recordAnchor(file, {
    action: REGISTER,
    transactionHash,
    blockNumber: String(blockNumber),
    status,
    contract: executor,
    gasUsed: String(gasUsed),
  });

  if (status !== 'success')
    throw new KeeperError('writeUnconfirmed', `the action registration is ${status}`);

  const spec = await chain.readAction(executor, artifact, selector);
  confirmAction(spec);
  return { transactionHash, blockNumber: String(blockNumber), spec };
}
