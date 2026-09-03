import {
  ANCHOR_FILE,
  confirmAnchor,
  refuseRepeat,
  type Anchor,
  type AnchorAction,
} from '../chain/anchors.js';
import {
  readEtherBalance,
  readTokenBalance,
  sendDirect,
  simulateHolding,
  transferToCalldata,
  type HoldingChange,
  type SignerRole,
  type SimulatedCall,
} from '../chain/client.js';
import { PRINCIPAL_HOLDING, requireAddress } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { readRecords } from '../shared/jsonl.js';

/** Enough for the one transfer the buyer has to sign, and deliberately not more. */
export const GAS_GRANT = 5_000_000_000_000_000n;

export interface ResetChain {
  ether: (holder: `0x${string}`) => Promise<bigint>;
  holding: (holder: `0x${string}`) => Promise<bigint>;
  simulate: (
    token: `0x${string}`,
    holder: `0x${string}`,
    calls: readonly SimulatedCall[],
  ) => Promise<HoldingChange>;
  send: (
    role: SignerRole,
    to: `0x${string}`,
    value: bigint,
    data?: `0x${string}`,
  ) => Promise<`0x${string}`>;
  confirm: (action: AnchorAction, hash: `0x${string}`) => Promise<Anchor>;
}

const CHAIN: ResetChain = {
  ether: readEtherBalance,
  holding: (holder) => readTokenBalance(requireAddress('asset'), holder),
  simulate: simulateHolding,
  send: sendDirect,
  confirm: confirmAnchor,
};

export interface ReturnedChain {
  holding: (holder: `0x${string}`, atBlock: bigint) => Promise<bigint>;
}

const RETURNED: ReturnedChain = {
  holding: (holder, atBlock) => readTokenBalance(requireAddress('asset'), holder, atBlock),
};

export interface ReturnedRun {
  chain?: ReturnedChain;
  anchors?: string;
}

/** Measured across each anchored return rather than recorded by us, so the chain is the source. */
export async function returnedByBuyer({
  chain = RETURNED,
  anchors = ANCHOR_FILE,
}: ReturnedRun = {}): Promise<bigint> {
  const buyer = requireAddress('counterparty');
  const returns = readRecords<Anchor>(anchors).filter(
    (anchor) => anchor.action === 'return-holding' && anchor.status === 'success',
  );
  let total = 0n;
  for (const anchor of returns) {
    const at = BigInt(anchor.blockNumber);
    total += (await chain.holding(buyer, at - 1n)) - (await chain.holding(buyer, at));
  }
  return total;
}

export interface ResetReport {
  funded: Anchor | null;
  returned: Anchor;
  investorHolds: bigint;
  buyerHolds: bigint;
}

export interface ResetRun {
  chain?: ResetChain;
  anchors?: string;
}

const landed = (anchor: Anchor, what: string): Anchor => {
  if (anchor.status !== 'success')
    throw new KeeperError('writeUnconfirmed', `${what} reverted at ${anchor.transactionHash}`);
  return anchor;
};

/** The buyer has never needed gas before, so it is funded only when it is actually short. */
async function fund(
  chain: ResetChain,
  anchors: string,
  buyer: `0x${string}`,
): Promise<Anchor | null> {
  if ((await chain.ether(buyer)) >= GAS_GRANT) return null;
  refuseRepeat('fund-counterparty', anchors);
  const investor = requireAddress('principal');
  if ((await chain.ether(investor)) <= GAS_GRANT)
    throw new KeeperError('actionRefused', 'the investor cannot cover the gas the buyer needs');
  return landed(
    await chain.confirm('fund-counterparty', await chain.send('principal', buyer, GAS_GRANT)),
    'the funding',
  );
}

/** Read for free against the live token, so a transfer the token would refuse costs no gas. */
async function requireReturnable(
  chain: ResetChain,
  asset: `0x${string}`,
  buyer: `0x${string}`,
  data: `0x${string}`,
  amount: bigint,
): Promise<void> {
  const call: SimulatedCall = { to: asset, data, value: 0n };
  const change = await chain.simulate(asset, buyer, [call]);
  if (!change.ran || change.before !== amount || change.after !== 0n)
    throw new KeeperError(
      'actionRefused',
      `returning ${String(amount)} would leave the buyer holding ${String(change.after)}`,
    );
}

/** The buyer sits on its concentration limit, so until it returns these no sale can pass. */
export async function resetDemoState({
  chain = CHAIN,
  anchors = ANCHOR_FILE,
}: ResetRun = {}): Promise<ResetReport> {
  refuseRepeat('return-holding', anchors);
  const buyer = requireAddress('counterparty');
  const investor = requireAddress('principal');
  const asset = requireAddress('asset');

  const held = await chain.holding(buyer);
  if (held === 0n) throw new KeeperError('actionRefused', 'the buyer holds nothing to return');

  const funded = await fund(chain, anchors, buyer);
  const data = transferToCalldata(investor, held);
  await requireReturnable(chain, asset, buyer, data, held);

  const returned = landed(
    await chain.confirm('return-holding', await chain.send('counterparty', asset, 0n, data)),
    'the return',
  );

  const investorHolds = await chain.holding(investor);
  const buyerHolds = await chain.holding(buyer);
  if (investorHolds !== PRINCIPAL_HOLDING || buyerHolds !== 0n)
    throw new KeeperError(
      'readBackMismatch',
      `the investor holds ${String(investorHolds)} and the buyer ${String(buyerHolds)}`,
    );

  return { funded, returned, investorHolds, buyerHolds };
}
