import { sendRoutedAction } from '../brickken/execute.js';
import type { Settlement } from '../brickken/settlement.js';
import { ANCHOR_FILE, confirmAnchor, type Anchor, type AnchorAction } from '../chain/anchors.js';
import { readTokenBalance, sendDirect, transferToCalldata } from '../chain/client.js';
import { actOnIntent, intentOf, lastProceed } from '../keeper/act.js';
import type { Decision, GuardReads } from '../keeper/guard.js';
import type { DeliverIntent } from '../keeper/intent.js';
import { requireAddress } from '../shared/config.js';
import { nextAction, nextReturn } from './spend.js';

export interface SentFromPage {
  decision: Decision;
  delivered: Settlement;
  returned: Anchor | null;
}

export interface PageChain {
  act: typeof actOnIntent;
  holding: (holder: `0x${string}`) => Promise<bigint>;
  send: (
    role: 'counterparty',
    to: `0x${string}`,
    value: bigint,
    data: `0x${string}`,
  ) => Promise<`0x${string}`>;
  confirm: typeof confirmAnchor;
}

const CHAIN: PageChain = {
  act: actOnIntent,
  holding: (holder) => readTokenBalance(requireAddress('asset'), holder),
  send: (role, to, value, data) => sendDirect(role, to, value, data),
  confirm: confirmAnchor,
};

export interface PageActionRun {
  intent: DeliverIntent;
  reads: GuardReads;
  chain?: PageChain;
  anchors?: string;
}

export const recordedIntent = (): DeliverIntent => intentOf(lastProceed());

/** The buyer sends its own tokens straight back, so the next visitor meets a clean board. */
async function giveBack(
  chain: PageChain,
  anchors: string,
  name: AnchorAction,
): Promise<Anchor | null> {
  const buyer = requireAddress('counterparty');
  const held = await chain.holding(buyer);
  if (held === 0n) return null;
  const data = transferToCalldata(requireAddress('principal'), held);
  const hash = await chain.send('counterparty', requireAddress('asset'), 0n, data);
  return chain.confirm(name, hash, { file: anchors });
}

/** Sends, then puts the tokens back where they came from, so the next visitor starts clean. */
export async function sendFromPage({
  intent,
  reads,
  chain = CHAIN,
  anchors = ANCHOR_FILE,
}: PageActionRun): Promise<SentFromPage> {
  const name = nextAction(anchors);
  const back = nextReturn(anchors);
  const { decision, settlement } = await chain.act(intent, {
    reads,
    send: (run) => sendRoutedAction({ ...run, name, anchors }),
  });

  const returned = await giveBack(chain, anchors, back);
  return { decision, delivered: settlement, returned };
}
