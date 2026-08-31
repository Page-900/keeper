import { describe, expect, it } from 'vitest';

import { gatherMaterial, issuerTerms, readDocument } from '../src/keeper/material.js';
import {
  POLICY,
  policyBreaches,
  policyInPlainWords,
  settlementAddresses,
  type Delivery,
} from '../src/keeper/policy.js';
import {
  PRINCIPAL_HOLDING,
  SUNL_DECIMALS,
  SUNL_SYMBOL,
  requireAddress,
} from '../src/shared/config.js';
import { captureError } from './support/capture-error.js';

const sunl = (whole: bigint): bigint => whole * 10n ** BigInt(SUNL_DECIMALS);

const document = readDocument();

describe('the offering material is third party text and is fictional throughout', () => {
  it('carries no address that could be a real inbox', () => {
    const addresses = document.match(/[\w.+-]+@[\w.-]+/g) ?? [];

    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) expect(address).toMatch(/@example\.com$/);
  });

  it('carries no link, so nothing in it can point a reader at a real site', () => {
    expect(document).not.toMatch(/https?:\/\//);
  });

  it('carries no wallet address, key, or hash that could be mistaken for a real one', () => {
    expect(document).not.toMatch(/0x[0-9a-fA-F]{16,}/);
  });

  it('names the buyer it asks to be paid by, so an unnamed recipient is a change', () => {
    expect(document).toContain('Harbour Lane Partners');
  });
});

describe('the numbers a stranger can check come from the issuer, never from our prose', () => {
  it('reads the live terms out of the record the issuer answered with', () => {
    const { tokenPrice, acceptedCoin, endDate } = issuerTerms();

    expect(tokenPrice).toBe('50.0');
    expect(acceptedCoin).toBe('BKN');
    expect(endDate).toBe('2026-09-04T21:25:35.000Z');
  });

  it('takes the latest record for the symbol and never a different token', () => {
    expect(issuerTerms().symbol).toBe(SUNL_SYMBOL);
  });

  it('refuses rather than inventing terms when the symbol was never offered', async () => {
    const error = await captureError(() => Promise.resolve(issuerTerms(undefined, 'NOPE')));

    expect(error.kind).toBe('brickkenUnreadable');
  });

  it('never restates the issuer price in our prose, so the two cannot disagree', () => {
    expect(document).not.toContain(issuerTerms().tokenPrice);
  });

  it('hands the reader both halves, marked apart', () => {
    const material = gatherMaterial();

    expect(material.document).toContain('Sunrise Lodge');
    expect(material.issuer.tokenPrice).toBe('50.0');
  });
});

const delivery = (over: Partial<Delivery> = {}): Delivery => ({
  amount: sunl(250n),
  pricePerToken: 47n,
  holding: sunl(1_750n),
  buyerHolds: 0n,
  recipient: requireAddress('counterparty'),
  ...over,
});

describe('the policy is the app layer, and it refuses things the chain would allow', () => {
  it('allows the delivery the standing bid actually asks for', () => {
    expect(policyBreaches(delivery())).toEqual([]);
  });

  it('refuses a price under the floor, which no on-chain rule would stop', () => {
    const breaches = policyBreaches(delivery({ pricePerToken: 44n }));

    expect(breaches.map((breach) => breach.rule)).toEqual(['price floor']);
  });

  it('refuses piling more than the limit onto one buyer across several deliveries', () => {
    const breaches = policyBreaches(delivery({ buyerHolds: sunl(400n) }));

    expect(breaches.map((breach) => breach.rule)).toContain('counterparty concentration');
  });

  it('refuses a delivery that would take the holding under its floor', () => {
    const breaches = policyBreaches(
      delivery({ amount: sunl(600n), holding: sunl(1_750n), buyerHolds: 0n }),
    );

    expect(breaches.map((breach) => breach.rule)).toContain('holding floor');
  });

  it('refuses an address the holder never named, whatever the document says', () => {
    const breaches = policyBreaches(delivery({ recipient: `0x${'ab'.repeat(20)}` }));

    expect(breaches.map((breach) => breach.rule)).toEqual(['settlement address']);
  });

  it('settles only to addresses the config module already publishes', () => {
    expect(settlementAddresses()).toEqual([requireAddress('counterparty')]);
  });

  it('reports every rule an intent breaks, not only the first one found', () => {
    const breaches = policyBreaches(delivery({ amount: sunl(600n), pricePerToken: 10n }));

    expect(breaches.length).toBeGreaterThan(1);
  });

  it('binds before the mandate does, which is the point of having it at all', () => {
    expect(POLICY.maximumToOneCounterparty).toBeLessThan(PRINCIPAL_HOLDING);
    expect(PRINCIPAL_HOLDING - POLICY.holdingFloor).toBeLessThan(PRINCIPAL_HOLDING);
  });

  it('states itself in words a person who does not code can check', () => {
    const words = policyInPlainWords();

    expect(words).toHaveLength(4);
    for (const line of words) expect(line).toMatch(/^[A-Z].*\.$/);
  });
});
