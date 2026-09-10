import { PROBE_MANDATE, type AddressName } from '../shared/config.js';
import { readRecords } from '../shared/jsonl.js';
import { ANCHOR_FILE, type Anchor } from './anchors.js';
import { readRegistryState } from './registry.js';
import { retiredSpend } from './retired.js';

const LEGAL = 'battery-legal';

/** A re-grant resets the registry counter and never the approval, so the sends are counted. */
export const probeDrawn = (file: string = ANCHOR_FILE): bigint => {
  const sent = new Set(
    readRecords<Anchor>(file)
      .filter((anchor) => anchor.action.startsWith(LEGAL) && anchor.status === 'success')
      .map((anchor) => anchor.transactionHash),
  );
  return BigInt(sent.size) * PROBE_MANDATE.maxTransactionValue;
};

const DRAWERS: readonly AddressName[] = Object.freeze(['agent', 'router']);

/** A revoked mandate keeps its number on the chain, so only a live one is counted here. */
export async function liveSpend(agents: readonly AddressName[] = DRAWERS): Promise<bigint> {
  let total = 0n;
  for (const agent of agents) {
    const state = await readRegistryState({ agent });
    if (state.mandateGranted && !state.mandateRevoked) total += BigInt(state.cumulativeUsed);
  }
  return total;
}

/** Everything the executor has ever moved, across every mandate that drew on the same approval. */
export async function drawnEver(): Promise<bigint> {
  return (await liveSpend()) + probeDrawn() + retiredSpend();
}
