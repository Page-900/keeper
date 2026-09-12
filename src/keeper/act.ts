import { sendRoutedAction, type ActionRun } from '../brickken/execute.js';
import { simulateAgentAction, type AgentAction } from '../chain/action.js';
import { KeeperError } from '../shared/errors.js';
import { readRecords } from '../shared/jsonl.js';
import { ANCHOR_FILE, type Anchor, type AnchorAction } from '../chain/anchors.js';
import { GUARD_FILE, guardIntent, type Decision, type GuardReads } from './guard.js';
import type { DeliverIntent } from './intent.js';
import { POLICY, type Policy } from './policy.js';
import type { Settlement } from '../brickken/settlement.js';

const ACTED = 'keeper-action';

/** An action is refused under a name already used, so each fresh one takes the next number. */
export const nextKeeperAction = (file: string = ANCHOR_FILE): AnchorAction => {
  const sent = readRecords<Anchor>(file).filter((anchor) => anchor.action.startsWith(ACTED));
  return sent.length === 0 ? ACTED : (`keeper-action-${String(sent.length + 1)}` as AnchorAction);
};

export function lastProceed(file: string = GUARD_FILE): Decision {
  const found = readRecords<Decision>(file)
    .filter((decision) => decision.verdict === 'proceed')
    .at(-1);
  if (found === undefined)
    throw new KeeperError('actionRefused', 'no decision has been recorded that the guard passed');
  return found;
}

/** Rebuilt from the record so the send carries the intent the operator read, not a fresh one. */
export function intentOf(decision: Decision): DeliverIntent {
  if (decision.action !== 'deliver' || decision.recipient === null)
    throw new KeeperError('actionRefused', 'the recorded decision moves nothing');
  return {
    action: 'deliver',
    amount: BigInt(decision.amount),
    pricePerToken: BigInt(decision.pricePerToken),
    recipient: decision.recipient,
    rationale: decision.rationale,
    sendItNow: false,
  };
}

export interface ActRun {
  reads: GuardReads;
  file?: string;
  anchors?: string;
  policy?: Policy;
  simulate?: (action: AgentAction) => Promise<void>;
  send?: (run: ActionRun) => Promise<Settlement>;
  nowSeconds?: number;
}

export interface KeeperAction {
  decision: Decision;
  settlement: Settlement;
}

/** The guard runs again on a fresh read, because whatever approved this is already out of date. */
export async function actOnIntent(intent: DeliverIntent, run: ActRun): Promise<KeeperAction> {
  const action: AgentAction = { to: intent.recipient, amount: intent.amount };

  const again = await guardIntent(intent, {
    reads: run.reads,
    policy: run.policy ?? POLICY,
    ...(run.file === undefined ? {} : { file: run.file }),
    ...(run.nowSeconds === undefined ? {} : { nowSeconds: run.nowSeconds }),
  });
  if (again.verdict !== 'proceed')
    throw new KeeperError(
      'actionRefused',
      `the guard now refuses it: ${again.refusals.map((refusal) => refusal.rule).join(', ')}`,
    );

  await (run.simulate ?? simulateAgentAction)(action);
  const name = nextKeeperAction(run.anchors);
  const settlement = await (run.send ?? sendRoutedAction)({ action, name });
  return { decision: again, settlement };
}

export const actOnDecision = (run: ActRun): Promise<KeeperAction> =>
  actOnIntent(intentOf(lastProceed(run.file)), run);
