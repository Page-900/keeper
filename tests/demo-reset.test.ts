import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Anchor, AnchorAction } from '../src/chain/anchors.js';
import { transferToCalldata, type HoldingChange, type SignerRole } from '../src/chain/client.js';
import {
  GAS_GRANT,
  resetDemoState,
  returnedByBuyer,
  type ResetChain,
  type ReturnedChain,
} from '../src/demo/reset.js';
import { CHAIN_ID, PRINCIPAL_HOLDING, requireAddress } from '../src/shared/config.js';
import { appendRecord } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';

const BUYER = requireAddress('counterparty');
const INVESTOR = requireAddress('principal');
const ASSET = requireAddress('asset');
const RETURNED = 500_000_000_000_000_000_000n;
const KEPT = PRINCIPAL_HOLDING - RETURNED;
const SENT_HASH: `0x${string}` = `0x${'22'.repeat(32)}`;

interface Sent {
  role: SignerRole;
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
}

const anchorOf = (action: AnchorAction, status: Anchor['status']): Anchor => ({
  at: '2026-08-31T00:00:00.000Z',
  action,
  chainId: CHAIN_ID,
  transactionHash: `0x${'11'.repeat(32)}`,
  blockNumber: '11606000',
  status,
  contract: null,
  gasUsed: '21000',
});

interface Options {
  buyerEther?: bigint;
  investorEther?: bigint;
  change?: Partial<HoldingChange>;
  status?: Anchor['status'];
  landsOnChain?: boolean;
}

const fakeChain = (options: Options = {}): { sent: Sent[]; chain: ResetChain } => {
  const sent: Sent[] = [];
  const status = options.status ?? 'success';
  const holdings = new Map<string, bigint>([
    [BUYER, RETURNED],
    [INVESTOR, KEPT],
  ]);
  const chain: ResetChain = {
    ether: (holder) =>
      Promise.resolve(
        holder === BUYER ? (options.buyerEther ?? 0n) : (options.investorEther ?? GAS_GRANT * 4n),
      ),
    holding: (holder) => Promise.resolve(holdings.get(holder) ?? 0n),
    simulate: () => Promise.resolve({ before: RETURNED, after: 0n, ran: true, ...options.change }),
    send: (role, to, value, data = '0x') => {
      sent.push({ role, to, value, data });
      return Promise.resolve(SENT_HASH);
    },
    confirm: (action) => {
      if (action === 'return-holding' && (options.landsOnChain ?? true)) {
        holdings.set(BUYER, 0n);
        holdings.set(INVESTOR, PRINCIPAL_HOLDING);
      }
      return Promise.resolve(anchorOf(action, status));
    },
  };
  return { sent, chain };
};

let directory = '';
let anchors = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-reset-'));
  anchors = join(directory, 'chain-anchors.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('the buyer returns the holding that has the agent refusing every sale', () => {
  it('moves the whole balance back to the investor, signed by the buyer and nobody else', async () => {
    const { sent, chain } = fakeChain({ buyerEther: GAS_GRANT });

    const report = await resetDemoState({ chain, anchors });

    expect(sent).toEqual([
      { role: 'counterparty', to: ASSET, value: 0n, data: transferToCalldata(INVESTOR, RETURNED) },
    ]);
    expect(report.investorHolds).toBe(PRINCIPAL_HOLDING);
    expect(report.buyerHolds).toBe(0n);
    expect(report.funded).toBeNull();
  });

  it('funds the buyer first when it cannot pay for its own transfer', async () => {
    const { sent, chain } = fakeChain({ buyerEther: 0n });

    const report = await resetDemoState({ chain, anchors });

    expect(sent[0]).toEqual({ role: 'principal', to: BUYER, value: GAS_GRANT, data: '0x' });
    expect(sent).toHaveLength(2);
    expect(report.funded?.action).toBe('fund-counterparty');
  });

  it('sends nothing at all when the evidence already records a return', async () => {
    appendRecord(anchors, anchorOf('return-holding', 'success'));
    const { sent, chain } = fakeChain();

    expect((await captureError(() => resetDemoState({ chain, anchors }))).kind).toBe(
      'alreadyCreated',
    );
    expect(sent).toEqual([]);
  });

  it('spends no gas when the token would refuse the transfer', async () => {
    const { sent, chain } = fakeChain({ buyerEther: GAS_GRANT, change: { ran: false } });

    expect((await captureError(() => resetDemoState({ chain, anchors }))).kind).toBe(
      'actionRefused',
    );
    expect(sent).toEqual([]);
  });

  it('spends no gas when the simulation leaves the buyer holding anything', async () => {
    const { sent, chain } = fakeChain({ buyerEther: GAS_GRANT, change: { after: 1n } });

    expect((await captureError(() => resetDemoState({ chain, anchors }))).kind).toBe(
      'actionRefused',
    );
    expect(sent).toEqual([]);
  });

  it('refuses when the investor cannot cover the gas the buyer needs', async () => {
    const { sent, chain } = fakeChain({ buyerEther: 0n, investorEther: GAS_GRANT });

    expect((await captureError(() => resetDemoState({ chain, anchors }))).kind).toBe(
      'actionRefused',
    );
    expect(sent).toEqual([]);
  });

  it('refuses a transaction that reverted rather than reporting it as a reset', async () => {
    const { chain } = fakeChain({ buyerEther: GAS_GRANT, status: 'reverted' });

    expect((await captureError(() => resetDemoState({ chain, anchors }))).kind).toBe(
      'writeUnconfirmed',
    );
  });

  it('believes the chain and not the receipt, so a silent no-op is caught', async () => {
    const { chain } = fakeChain({ buyerEther: GAS_GRANT, landsOnChain: false });

    expect((await captureError(() => resetDemoState({ chain, anchors }))).kind).toBe(
      'readBackMismatch',
    );
  });
});

const RETURN_BLOCK = 11_607_079n;

const balancesAcross = (drop: bigint): ReturnedChain => ({
  holding: (_holder, atBlock) => Promise.resolve(atBlock < RETURN_BLOCK ? drop : 0n),
});

describe('how much the buyer sent back is measured off the chain, never recorded by us', () => {
  it('counts nothing from the agent transactions that moved tokens the other way', async () => {
    appendRecord(anchors, { ...anchorOf('keeper-action', 'success'), blockNumber: '11607079' });

    expect(await returnedByBuyer({ chain: balancesAcross(RETURNED), anchors })).toBe(0n);
  });

  it('measures the drop across the block the return landed in', async () => {
    appendRecord(anchors, { ...anchorOf('return-holding', 'success'), blockNumber: '11607079' });

    expect(await returnedByBuyer({ chain: balancesAcross(RETURNED), anchors })).toBe(RETURNED);
  });

  it('counts nothing from a return that reverted', async () => {
    appendRecord(anchors, { ...anchorOf('return-holding', 'reverted'), blockNumber: '11607079' });

    expect(await returnedByBuyer({ chain: balancesAcross(RETURNED), anchors })).toBe(0n);
  });
});
