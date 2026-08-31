import { sendAgentAction, type ActionRun } from '../brickken/execute.js';
import { simulateAgentAction, type AgentAction } from '../chain/action.js';
import { KeeperError } from '../shared/errors.js';
import { readRecords } from '../shared/jsonl.js';
import { GUARD_FILE, guardIntent, type Decision, type GuardReads } from './guard.js';
import type { DeliverIntent } from './intent.js';
import { POLICY, type Policy } from './policy.js';
import type { Settlement } from '../brickken/settlement.js';

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
  };
}

export interface ActRun {
  reads: GuardReads;
  file?: string;
  policy?: Policy;
  simulate?: (action: AgentAction) => Promise<void>;
  send?: (run: ActionRun) => Promise<Settlement>;
  nowSeconds?: number;
}

export interface KeeperAction {
  decision: Decision;
  settlement: Settlement;
}

/** The guard runs again on a fresh read, because the recorded one is already out of date. */
export async function actOnDecision(run: ActRun): Promise<KeeperAction> {
  const recorded = lastProceed(run.file);
  const intent = intentOf(recorded);
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
  const settlement = await (run.send ?? sendAgentAction)({ action, name: 'keeper-action' });
  return { decision: again, settlement };
}
