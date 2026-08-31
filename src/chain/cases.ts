import {
  SECOND_ACTION_ID,
  TRANSFER_ACTION,
  requireAddress,
  type AddressName,
  type MandateSpec,
} from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { readRecords } from '../shared/jsonl.js';
import {
  approveCalldata,
  simulateRefusal,
  transferCalldata,
  writeWithGasLimit,
  type RevertReason,
  type SignerRole,
} from './client.js';
import {
  ANCHOR_FILE,
  confirmAnchor,
  refuseRepeat,
  type Anchor,
  type AnchorAction,
} from './anchors.js';
import { EXECUTOR_ARTIFACT, compiledArtifact } from './artifacts.js';
import {
  BATTERY_FILE,
  recordCase,
  requireLayerRevert,
  type BatteryCase,
  type Layer,
} from './battery.js';
import { agreeWithChain, evaluate, type Clause } from './differential.js';
import { readCanExecute, readRegistryState, type RegistryRead } from './registry.js';

export interface CaseSpec {
  name: string;
  layer: Layer;
  expect: Clause | null;
  asset: AddressName;
  action: `0x${string}`;
  to: AddressName;
  amount: bigint;
}

export interface CaseChain {
  state: (agent: SignerRole, action: `0x${string}`) => Promise<RegistryRead>;
  canExecute: (state: RegistryRead, spec: CaseSpec, agent: SignerRole) => Promise<boolean>;
  simulate: (spec: CaseSpec, agent: SignerRole) => Promise<RevertReason | null>;
  send: (spec: CaseSpec, agent: SignerRole) => Promise<`0x${string}`>;
  confirm: (name: string, hash: `0x${string}`) => Promise<{ status: string; blockNumber: string }>;
}

/** A call meant to revert cannot be gas estimated, because the estimate is the revert. */
const GAS_LIMIT = 400_000n;

export const CHAIN: CaseChain = {
  state: (agent, action) => readRegistryState({ agent, action }),
  canExecute: (state, spec, agent) =>
    readCanExecute({
      agent: requireAddress(agent),
      principal: requireAddress('principal'),
      asset: requireAddress(spec.asset),
      action: spec.action,
      amount: spec.amount,
      atBlock: BigInt(state.blockNumber),
    }),
  simulate: (spec, agent) =>
    simulateRefusal(
      agent,
      requireAddress('executor'),
      compiledArtifact(EXECUTOR_ARTIFACT),
      'execute',
      [requireAddress(spec.asset), calldataFor(spec)],
    ),
  send: (spec, agent) =>
    writeWithGasLimit(
      agent,
      requireAddress('executor'),
      compiledArtifact(EXECUTOR_ARTIFACT),
      'execute',
      [requireAddress(spec.asset), calldataFor(spec)],
      GAS_LIMIT,
    ),
  confirm: async (name, hash) => {
    const anchor = await confirmAnchor(`battery-${name}`, hash);
    return { status: anchor.status, blockNumber: anchor.blockNumber };
  },
};

export const calldataFor = (spec: CaseSpec): `0x${string}` =>
  spec.action === SECOND_ACTION_ID
    ? approveCalldata(requireAddress(spec.to), spec.amount)
    : transferCalldata(requireAddress('principal'), requireAddress(spec.to), spec.amount);

export const alreadyRun = (name: string, file: string = BATTERY_FILE): boolean =>
  readRecords<BatteryCase>(file).some((record) => record.case === name);

export interface CaseRun {
  chain: CaseChain;
  agent: SignerRole;
  file?: string;
  anchors?: string;
}

/** Proved by free reads first, and only then does it cost gas. A wrong attribution costs more. */
export async function runCase(spec: CaseSpec, run: CaseRun): Promise<BatteryCase> {
  const file = run.file ?? BATTERY_FILE;
  if (alreadyRun(spec.name, file))
    throw new KeeperError('alreadyCreated', `${spec.name} is already recorded`);

  const state = await run.chain.state(run.agent, spec.action);
  const evaluation = evaluate(state, spec.amount, requireAddress(spec.asset));
  agreeWithChain(evaluation, await run.chain.canExecute(state, spec, run.agent));

  if (evaluation.firstFalse !== spec.expect)
    throw new KeeperError(
      'refusalUnattributable',
      `${spec.name} should fail on ${spec.expect ?? 'nothing'} and fails on ${evaluation.firstFalse ?? 'nothing'}`,
    );

  if (evaluation.allowed)
    throw new KeeperError(
      'refusalUnattributable',
      `${spec.name} is a refusal and the mandate allows it`,
    );

  const revert = await run.chain.simulate(spec, run.agent);
  requireLayerRevert(spec.name, spec.layer, revert);

  const hash = await run.chain.send(spec, run.agent);
  const receipt = await run.chain.confirm(spec.name, hash);
  if (receipt.status !== 'reverted')
    throw new KeeperError('writeUnconfirmed', `${spec.name} is ${receipt.status} and not reverted`);

  return recordCase(file, {
    case: spec.name,
    layer: spec.layer,
    blockNumber: receipt.blockNumber,
    transactionHash: hash,
    revert,
    firstFalse: evaluation.firstFalse,
    clauses: evaluation.clauses,
    agreedWithChain: true,
    state,
  });
}

export interface LegalRun {
  transactionHash: `0x${string}`;
  blockNumber: string;
  spentAfter: string;
}

export const legalAnchor = (name: string): AnchorAction => `battery-${name}`;

export const legalAlreadySent = (name: string, anchors: string = ANCHOR_FILE): boolean =>
  readRecords<Anchor>(anchors).some(
    (anchor) => anchor.action === legalAnchor(name) && anchor.status === 'success',
  );

/** Not a case, so nothing records one. The anchor file is what stops a second send. */
export async function runLegal(spec: CaseSpec, run: CaseRun): Promise<LegalRun> {
  refuseRepeat(legalAnchor(spec.name), run.anchors ?? ANCHOR_FILE);
  const state = await run.chain.state(run.agent, spec.action);
  const evaluation = evaluate(state, spec.amount, requireAddress(spec.asset));
  agreeWithChain(evaluation, await run.chain.canExecute(state, spec, run.agent));
  if (!evaluation.allowed)
    throw new KeeperError(
      'actionRefused',
      `a run meant to be legal is refused on ${evaluation.firstFalse ?? 'nothing'}`,
    );

  const hash = await run.chain.send(spec, run.agent);
  const receipt = await run.chain.confirm(spec.name, hash);
  if (receipt.status !== 'success')
    throw new KeeperError('writeUnconfirmed', `${spec.name} is ${receipt.status} and not success`);
  return {
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    spentAfter: state.cumulativeUsed,
  };
}

const probe = (name: string, expect: Clause, over: Partial<CaseSpec> = {}): CaseSpec => ({
  name,
  layer: 'mandate',
  expect,
  asset: 'asset',
  action: TRANSFER_ACTION,
  to: 'principal',
  amount: 0n,
  ...over,
});

/** The order is the deliverable. Written as a set these produce true reverts and false reasons. */
export const cycleOne = (spec: MandateSpec): CaseSpec[] => [
  probe('T1', 'window', { amount: spec.maxTransactionValue }),
  probe('C1', 'per transaction cap', { amount: spec.maxTransactionValue + 1n }),
  probe('A1', 'action', { action: SECOND_ACTION_ID, amount: spec.maxTransactionValue }),
  probe('S1', 'asset', { asset: 'uncleared', amount: spec.maxTransactionValue }),
  probe('C2', 'cumulative cap', { amount: spec.maxTransactionValue }),
  probe('T2', 'window', { amount: spec.maxTransactionValue }),
];

/** Run before the legal transfers, so the cumulative cap is not a second reason they fail. */
export const BEFORE_THE_CAP_IS_SPENT = ['T1', 'C1', 'A1', 'S1'] as const;

/** The window must still be open, because the contract tests it before it tests revocation. */
export const afterRevocation = (spec: MandateSpec): CaseSpec =>
  probe('V1', 'revoked', { amount: spec.maxTransactionValue });

export const legalRuns = (spec: MandateSpec): CaseSpec[] =>
  Array.from({ length: Number(spec.maxCumulativeValue / spec.maxTransactionValue) }, (_, at) => ({
    name: `legal-${String(at + 1)}`,
    layer: 'mandate' as const,
    expect: null,
    asset: 'asset' as const,
    action: TRANSFER_ACTION,
    to: 'principal' as const,
    amount: spec.maxTransactionValue,
  }));
