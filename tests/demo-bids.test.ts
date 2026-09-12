import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bidTerms, listBids, readBid } from '../src/demo/bids.js';
import { MAX_DOCUMENT_CHARACTERS } from '../src/demo/limits.js';
import {
  guardIntent,
  type Decision,
  type GuardReads,
  type RefusalSource,
} from '../src/keeper/guard.js';
import { readIntent } from '../src/keeper/intent.js';
import {
  MAX_CUMULATIVE_VALUE,
  MAX_TRANSACTION_VALUE,
  PRINCIPAL_HOLDING,
  SUNL_DECIMALS,
  requireAddress,
} from '../src/shared/config.js';
import { captureError } from './support/capture-error.js';
import { registryState } from './support/registry-state.js';

const WHOLE = ['# A title', '> What it is for.', '', 'The document itself.'].join('\n');

describe('a bid a visitor can try is one file and reads as one thing', () => {
  it('takes the title, the summary and the document out of the one file', () => {
    const bid = readBid(WHOLE, 'a-bid');

    expect(bid.id).toBe('a-bid');
    expect(bid.title).toBe('A title');
    expect(bid.says).toBe('What it is for.');
    expect(bid.document).toBe('The document itself.');
  });

  it('refuses a file that opens without a title, rather than showing an empty card', async () => {
    const error = await captureError(() =>
      Promise.resolve(readBid('> only a summary\n\nbody', 'nameless')),
    );

    expect(error.kind).toBe('bidUnreadable');
  });

  it('refuses a file that opens without a summary, so no card says nothing', async () => {
    const error = await captureError(() =>
      Promise.resolve(readBid('# only a title\n\nbody', 'wordless')),
    );

    expect(error.kind).toBe('bidUnreadable');
  });

  it('offers eight of them, in the order their names put them', () => {
    const bids = listBids();

    expect(bids).toHaveLength(8);
    expect(bids.map((bid) => bid.id)).toEqual([...bids.map((bid) => bid.id)].sort());
  });

  it('gives every one a title, a summary and a document with something in it', () => {
    for (const bid of listBids()) {
      expect([bid.id, bid.title.length > 0]).toEqual([bid.id, true]);
      expect([bid.id, bid.says.length > 0]).toEqual([bid.id, true]);
      expect([bid.id, bid.document.length > 40]).toEqual([bid.id, true]);
    }
  });

  it('keeps every one inside what the attack box will accept, or the button hands back a refusal', () => {
    for (const bid of listBids())
      expect([bid.id, bid.document.length <= MAX_DOCUMENT_CHARACTERS]).toEqual([bid.id, true]);
  });

  it('keeps every straightforward bid free of any address, so only the records name one', () => {
    for (const bid of listBids().slice(0, 4))
      expect([bid.id, bid.document.includes('0x')]).toEqual([bid.id, false]);
  });
});

const CAP = MAX_TRANSACTION_VALUE;
const CLEARED = requireAddress('counterparty');
const PRINCIPAL = requireAddress('principal');
const WITHIN_THE_WINDOW = 1_790_000_000;

const REFUSALS: Record<string, string[]> = {
  '1-straightforward': [],
  '2-a-better-price': [],
  '3-a-small-order': [],
  '4-far-more-than-allowed': [],
  '5-a-price-below-the-floor': ['price floor'],
  '6-an-amount-the-cap-forbids': ['per transaction cap'],
  '7-an-address-nobody-cleared': ['settlement address'],
  '8-a-forged-ending': [],
};

const SOURCES: Record<string, RefusalSource> = {
  '5-a-price-below-the-floor': 'policy',
  '6-an-amount-the-cap-forbids': 'mandate bound',
  '7-an-address-nobody-cleared': 'policy',
};

const reads: GuardReads = {
  state: () =>
    Promise.resolve(
      registryState({
        maxTransactionValue: String(CAP),
        maxCumulativeValue: String(MAX_CUMULATIVE_VALUE),
        cumulativeUsed: '0',
      }),
    ),
  balance: (holder) =>
    Promise.resolve(holder.toLowerCase() === PRINCIPAL.toLowerCase() ? PRINCIPAL_HOLDING : 0n),
};

const whole = (amount: bigint): string => String(amount / 10n ** BigInt(SUNL_DECIMALS));

const invited = (document: string, to?: `0x${string}`): unknown => {
  const terms = bidTerms(document);
  return {
    action: 'deliver',
    amountWholeTokens: whole(terms.partialFill && terms.buying > CAP ? CAP : terms.buying),
    pricePerToken: String(terms.pricePerToken),
    recipient: to ?? terms.settlesTo ?? CLEARED,
    rationale: 'exactly what the document asks for, taken at its word',
    sendItNow: false,
  };
};

describe('what a bid invites, put through the guard that would answer it', () => {
  let file: string;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'keeper-bids-'));
    file = join(directory, 'guard-decisions.jsonl');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const answer = (document: string, to?: `0x${string}`): Promise<Decision> =>
    guardIntent(readIntent(invited(document, to)), {
      reads,
      file,
      nowSeconds: WITHIN_THE_WINDOW,
    });

  it('names an expected answer for every bid on the page, so a new one cannot arrive unstated', () => {
    expect(listBids().map((bid) => bid.id)).toEqual(Object.keys(REFUSALS));
  });

  it('refuses each refused bid for a reason no other refused bid shares', () => {
    const rules = Object.values(REFUSALS).flat();

    expect(rules).toEqual([...new Set(rules)]);
  });

  it('gives back exactly the rules its document was written to trip, and no others', async () => {
    for (const bid of listBids()) {
      const decision = await answer(bid.document);

      expect([bid.id, decision.refusals.map((refusal) => refusal.rule)]).toEqual([
        bid.id,
        REFUSALS[bid.id],
      ]);
    }
  });

  it('attributes each refusal to the layer that owns that rule', async () => {
    for (const [id, source] of Object.entries(SOURCES)) {
      const bid = listBids().find((one) => one.id === id);
      const decision = await answer(bid?.document ?? '');

      expect([id, decision.refusals.map((refusal) => refusal.source)]).toEqual([id, [source]]);
    }
  });

  it('lets the forged ending through only while the address it forges is ignored', async () => {
    const forged = listBids().find((bid) => bid.id === '8-a-forged-ending');
    const named = /0x[0-9a-fA-F]{40}/.exec(forged?.document ?? '')?.[0] as `0x${string}`;
    const taken = await answer(forged?.document ?? '', named);

    expect(named).not.toBe(CLEARED);
    expect(taken.refusals.map((refusal) => refusal.rule)).toEqual(['settlement address']);
  });
});
