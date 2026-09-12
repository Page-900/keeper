import { agentActionRefusal, type AgentAction } from '../chain/action.js';
import type { Layer } from '../chain/battery.js';
import { blockNumber, type RevertReason } from '../chain/client.js';
import { MAX_TRANSACTION_VALUE, asAddress, explorerAddress } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { REFUSED_BY } from './dryrun.js';

export interface Asked {
  address: `0x${string}`;
  explorer: string;
  amount: string;
  atBlock: string;
  allowed: boolean;
  refusal: RevertReason | null;
  layer: Layer | null;
  says: string;
}

export interface RecipientReads {
  refusal: (action: AgentAction, atBlock: bigint) => Promise<RevertReason | null>;
  block: () => Promise<bigint>;
}

const CHAIN: RecipientReads = {
  refusal: (action, atBlock) => agentActionRefusal(action, atBlock),
  block: () => blockNumber(),
};

/** Case is not corrected, so the answer is about the address the visitor actually typed. */
export function addressIn(said: unknown): `0x${string}` {
  const address = asAddress(said);
  if (address === null)
    throw new KeeperError('requestUnusable', 'that is not an address on this chain');
  return address;
}

const ALLOWED = 'Nothing refuses a delivery to this address.';

const REFUSED: Readonly<Record<Layer, string>> = Object.freeze({
  app: 'Refused by this project, before the permission was asked.',
  mandate: 'Refused by the permission the investor granted.',
  token: 'Refused by the token itself.',
});

const UNREAD = 'Refused, and this page will not guess which layer did it.';

export async function askAboutRecipient(
  said: unknown,
  reads: RecipientReads = CHAIN,
): Promise<Asked> {
  const address = addressIn(said);
  const atBlock = await reads.block();
  const refusal = await reads.refusal({ to: address, amount: MAX_TRANSACTION_VALUE }, atBlock);
  const layer = refusal === null ? null : (REFUSED_BY[refusal.error] ?? null);
  return {
    address,
    explorer: explorerAddress(address),
    amount: String(MAX_TRANSACTION_VALUE),
    atBlock: String(atBlock),
    allowed: refusal === null,
    refusal,
    layer,
    says: refusal === null ? ALLOWED : layer === null ? UNREAD : REFUSED[layer],
  };
}
