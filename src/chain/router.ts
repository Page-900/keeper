import {
  PERMITTED_ACTION,
  SECOND_ACTION,
  requireAddress,
  type AddressName,
} from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { ANCHOR_FILE, recordAnchor, type AnchorAction } from './anchors.js';
import { ROUTER_ARTIFACT, compiledArtifact } from './artifacts.js';
import {
  readAllowed,
  readRoute,
  transactionReceipt,
  writeContract,
  type Artifact,
  type Receipt,
  type Route,
  type SignerRole,
} from './client.js';

const OWNER: SignerRole = 'principal';

const ROUTE: AnchorAction = 'route-action';

const ALLOW: AnchorAction = 'allow-recipient';

export const ROUTED_ACTIONS = Object.freeze([PERMITTED_ACTION, SECOND_ACTION]);

export interface RouterChain {
  write: (
    role: SignerRole,
    contract: `0x${string}`,
    artifact: Artifact,
    functionName: string,
    args: readonly unknown[],
  ) => Promise<`0x${string}`>;
  receipt: (hash: `0x${string}`) => Promise<Receipt>;
  route: (contract: `0x${string}`, artifact: Artifact, selector: `0x${string}`) => Promise<Route>;
  allowed: (
    contract: `0x${string}`,
    artifact: Artifact,
    recipient: `0x${string}`,
  ) => Promise<boolean>;
}

const CHAIN: RouterChain = {
  write: writeContract,
  receipt: transactionReceipt,
  route: readRoute,
  allowed: readAllowed,
};

export interface RouterRun {
  chain?: RouterChain;
  file?: string;
  artifact?: Artifact;
}

export interface RouterWrite {
  transactionHash: `0x${string}`;
  blockNumber: string;
}

async function sent(
  anchor: AnchorAction,
  what: string,
  { chain, file, artifact }: Required<RouterRun>,
  functionName: string,
  args: readonly unknown[],
): Promise<RouterWrite> {
  const router = requireAddress('router');
  const transactionHash = await chain.write(OWNER, router, artifact, functionName, args);
  const { status, blockNumber, gasUsed } = await chain.receipt(transactionHash);
  recordAnchor(file, {
    action: anchor,
    transactionHash,
    blockNumber: String(blockNumber),
    status,
    contract: router,
    gasUsed: String(gasUsed),
  });
  if (status !== 'success') throw new KeeperError('writeUnconfirmed', `${what} is ${status}`);
  return { transactionHash, blockNumber: String(blockNumber) };
}

const settings = (run: RouterRun): Required<RouterRun> => ({
  chain: run.chain ?? CHAIN,
  file: run.file ?? ANCHOR_FILE,
  artifact: run.artifact ?? compiledArtifact(ROUTER_ARTIFACT),
});

export interface RoutedAction {
  selector: `0x${string}`;
  recipientIndex: number;
}

export async function routeAction(
  action: RoutedAction = PERMITTED_ACTION,
  run: RouterRun = {},
): Promise<RouterWrite> {
  const filled = settings(run);
  const written = await sent(ROUTE, 'the route', filled, 'setRoute', [
    action.selector,
    true,
    action.recipientIndex,
  ]);
  const found = await filled.chain.route(
    requireAddress('router'),
    filled.artifact,
    action.selector,
  );
  if (!found.supported || found.recipientIndex !== action.recipientIndex)
    throw new KeeperError(
      'readBackMismatch',
      `routes() reads supported ${String(found.supported)} at argument ${String(found.recipientIndex)}`,
    );
  return written;
}

export async function allowRecipient(
  name: AddressName = 'counterparty',
  run: RouterRun = {},
): Promise<RouterWrite> {
  const filled = settings(run);
  const recipient = requireAddress(name);
  const written = await sent(ALLOW, 'the allowance of a recipient', filled, 'setAllowed', [
    recipient,
    true,
  ]);
  if (!(await filled.chain.allowed(requireAddress('router'), filled.artifact, recipient)))
    throw new KeeperError('readBackMismatch', `allowed() still refuses ${recipient}`);
  return written;
}
