import { describe, expect, it } from 'vitest';

import { PROPOSE_INTENT, readIntent } from '../src/keeper/intent.js';
import { SUNL_DECIMALS } from '../src/shared/config.js';
import { KeeperError } from '../src/shared/errors.js';

const ADDRESS = `0x${'ab'.repeat(20)}`;

const proposal = (over: Record<string, unknown> = {}): unknown => ({
  action: 'deliver',
  amountWholeTokens: '250',
  pricePerToken: '47',
  recipient: ADDRESS,
  rationale: 'the bid clears the floor and the occupancy note argues for a small size',
  ...over,
});

const refusalFor = (raw: unknown): KeeperError => {
  try {
    readIntent(raw);
  } catch (cause) {
    if (cause instanceof KeeperError) return cause;
    throw cause;
  }
  throw new Error('expected a refusal');
};

describe('the tool the model may call cannot execute anything', () => {
  it('closes the schema, so a field we never asked for is not a field it may send', () => {
    expect(PROPOSE_INTENT.parameters.additionalProperties).toBe(false);
  });

  it('is checked by our own validator, because no vendor guarantee is trusted here', () => {
    const error = refusalFor(proposal({ smuggled: 'extra', action: 'sideways' }));

    expect(error.kind).toBe('intentMalformed');
  });

  it('requires every field, so nothing arrives quietly missing', () => {
    expect(PROPOSE_INTENT.parameters.required).toEqual(
      Object.keys(PROPOSE_INTENT.parameters.properties),
    );
  });

  it('says in its own description that it proposes and does not move anything', () => {
    expect(PROPOSE_INTENT.description).toContain('cannot move anything');
  });
});

describe('a well formed proposal is read into exact amounts', () => {
  it('turns whole tokens into base units without ever touching a float', () => {
    const intent = readIntent(proposal());

    expect(intent.amount).toBe(250n * 10n ** BigInt(SUNL_DECIMALS));
    expect(intent.pricePerToken).toBe(47n);
  });

  it('keeps the address the model named, so the guard can judge it', () => {
    expect(readIntent(proposal()).recipient).toBe(ADDRESS);
  });

  it('accepts a decline, and gives it no amount and no recipient', () => {
    const intent = readIntent(
      proposal({ action: 'decline', amountWholeTokens: '0', recipient: '' }),
    );

    expect(intent.amount).toBe(0n);
    expect(intent.recipient).toBeNull();
  });
});

describe('a malformed proposal is refused before the guard ever sees it', () => {
  const cases: [string, unknown][] = [
    ['not an object at all', 'deliver 250'],
    ['an array pretending to be a proposal', []],
    ['a missing field', { action: 'deliver' }],
    ['a number where a digit string belongs', proposal({ amountWholeTokens: 250 })],
    ['a fractional amount', proposal({ amountWholeTokens: '250.5' })],
    ['a negative amount', proposal({ amountWholeTokens: '-250' })],
    ['an amount with too many digits to be real', proposal({ amountWholeTokens: '9'.repeat(40) })],
    ['a price that is not a number', proposal({ pricePerToken: 'best offer' })],
    ['an action we do not have', proposal({ action: 'transfer' })],
    ['an empty rationale', proposal({ rationale: '   ' })],
    ['a recipient that is not an address', proposal({ recipient: 'harbour lane partners' })],
    ['a recipient that is too short to be an address', proposal({ recipient: '0xabc' })],
    ['a delivery of nothing, which is a decline in disguise', proposal({ amountWholeTokens: '0' })],
    ['a decline that still carries an amount', proposal({ action: 'decline' })],
  ];

  for (const [what, raw] of cases) {
    it(`refuses ${what}`, () => {
      expect(refusalFor(raw).kind).toBe('intentMalformed');
    });
  }

  it('names what was wrong, so a refusal can be reported rather than guessed at', () => {
    expect(refusalFor(proposal({ amountWholeTokens: '250.5' })).detail).toContain(
      'amountWholeTokens',
    );
  });
});
