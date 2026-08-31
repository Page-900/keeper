import { agentCalldata, firstAction, type AgentAction } from '../chain/action.js';
import { ANCHOR_FILE, confirmAnchor, refuseRepeat, type AnchorAction } from '../chain/anchors.js';
import { transactionReceipt, type Receipt } from '../chain/client.js';
import { CHAIN_ID, requireAddress } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { createBrickkenClient, type TransactionStatus } from './client.js';
import { EVIDENCE_FILE, sdkWrite } from './log.js';
import {
  sdkClient,
  type ExecuteInput,
  type UnsignedTransactionLike,
  type WriteOptions,
  type WriteResult,
} from './sdk.js';
import { settledHash, type Settlement } from './settlement.js';

/** The agent spends the authority; the principal only ever grants it. */
const SIGNER = 'agent' as const;

const ACTION: AnchorAction = 'agent-action';

const METHOD = 'ramsExecute';

export interface ExecuteSurface {
  execute: (input: ExecuteInput, options: WriteOptions) => Promise<WriteResult>;
  settled: (txId: string) => Promise<TransactionStatus>;
}

const SURFACE: ExecuteSurface = {
  execute: (input, options) => sdkClient(SIGNER).rams.execute(input, options),
  settled: (txId) => createBrickkenClient().getTransactionStatus(txId),
};

const executeInput = ({ to, amount }: AgentAction): ExecuteInput => ({
  chainId: CHAIN_ID,
  agentMandateAddress: requireAddress('agentMandate'),
  executorAddress: requireAddress('executor'),
  asset: requireAddress('asset'),
  from: requireAddress('principal'),
  to,
  amount: String(amount),
});

export interface PreparedAction {
  txId: string;
  transactions: UnsignedTransactionLike[];
  carriesOurCall: boolean;
}

const options = (execute: boolean): WriteOptions => ({
  execute,
  signerAddress: requireAddress('agent'),
});

/** Preparing is free and sending is one-shot, so what they would send is read first. */
export async function prepareAgentAction(
  action: AgentAction = firstAction(),
  surface: ExecuteSurface = SURFACE,
  file: string = EVIDENCE_FILE,
): Promise<PreparedAction> {
  const { txId, transactions } = await sdkWrite(file, METHOD, () =>
    surface.execute(executeInput(action), options(false)),
  );
  if (txId === '' || transactions.length === 0)
    throw new KeeperError('brickkenUnreadable', 'the prepare returned no transaction to sign');
  const wanted = agentCalldata(action.to, action.amount).slice(2).toLowerCase();
  const calldata = transactions
    .map((transaction) => transaction.data)
    .join('')
    .toLowerCase();
  return { txId, transactions, carriesOurCall: calldata.includes(wanted) };
}

export interface ActionRun {
  action?: AgentAction;
  name?: AnchorAction;
  surface?: ExecuteSurface;
  anchors?: string;
  file?: string;
  receipt?: (hash: `0x${string}`) => Promise<Receipt>;
}

export async function sendAgentAction({
  action = firstAction(),
  name = ACTION,
  surface = SURFACE,
  anchors = ANCHOR_FILE,
  file = EVIDENCE_FILE,
  receipt = transactionReceipt,
}: ActionRun = {}): Promise<Settlement> {
  refuseRepeat(name, anchors);
  const prepared = await prepareAgentAction(action, surface, file);
  if (!prepared.carriesOurCall)
    throw new KeeperError('payloadMismatch', 'the prepared call is not the transfer we asked for');

  const result = await sdkWrite(file, METHOD, () =>
    surface.execute(executeInput(action), options(true)),
  );
  if (result.sent === undefined)
    throw new KeeperError('writeUnconfirmed', 'the action prepared but never sent');

  const transactionHash = await settledHash(surface, result.txId);
  const { status } = await confirmAnchor(name, transactionHash, { file: anchors, receipt });
  if (status !== 'success') throw new KeeperError('writeUnconfirmed', `the action is ${status}`);
  return { txId: result.txId, transactionHash };
}
