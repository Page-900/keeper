import type { AgentAction } from '../chain/action.js';
import { agentActionRefusal } from '../chain/action.js';
import type { Layer } from '../chain/battery.js';
import type { RevertReason } from '../chain/client.js';
import type { DeliverIntent } from '../keeper/intent.js';

export interface DryRun {
  layer: Layer;
  allowed: boolean;
  revert: RevertReason | null;
  atBlock: string;
}

/** AgentExecutor.execute checks its own two first, then canExecute, then calls the token. */
const REFUSED_BY: Readonly<Record<string, Layer>> = Object.freeze({
  InvalidData: 'app',
  UnsupportedAction: 'app',
  CannotExecute: 'mandate',
  CallFailed: 'token',
});

export interface DryRunReads {
  refusal: (action: AgentAction, atBlock: bigint) => Promise<RevertReason | null>;
}

const CHAIN: DryRunReads = {
  refusal: (action, atBlock) => agentActionRefusal(action, atBlock),
};

const answered = (layer: Layer, revert: RevertReason | null, atBlock: bigint): DryRun => ({
  layer,
  allowed: revert === null,
  revert,
  atBlock: String(atBlock),
});

/** An unnamed revert is left unattributed rather than guessed at. */
export async function dryRun(
  intent: DeliverIntent,
  atBlock: bigint,
  reads: DryRunReads = CHAIN,
): Promise<DryRun | null> {
  const action = { to: intent.recipient, amount: intent.amount };
  const revert = await reads.refusal(action, atBlock).catch(() => undefined);
  if (revert === undefined) return null;
  if (revert === null) return answered('token', null, atBlock);
  const layer = REFUSED_BY[revert.error];
  return layer === undefined ? null : answered(layer, revert, atBlock);
}
