import { describe, expect, it } from 'vitest';

import { createProposals, PROPOSAL_LAPSE_SECONDS } from '../src/demo/proposals.js';
import type { DeliverIntent } from '../src/keeper/intent.js';
import { requireAddress } from '../src/shared/config.js';

const intent: DeliverIntent = {
  action: 'deliver',
  amount: 25n,
  pricePerToken: 47n,
  recipient: requireAddress('counterparty'),
  rationale: 'the bid clears the floor',
  sendItNow: false,
};

describe('the proposal a second turn can send', () => {
  it('hands back what this visitor proposed', () => {
    const proposals = createProposals();
    proposals.keep('a-visitor', intent);

    expect(proposals.held('a-visitor')).toEqual(intent);
  });

  it('tells one visitor nothing about another', () => {
    const proposals = createProposals();
    proposals.keep('a-visitor', intent);

    expect(proposals.held('someone-else')).toBeNull();
  });

  it('forgets a proposal once it has waited too long', () => {
    let now = 0;
    const proposals = createProposals({ now: () => now });
    proposals.keep('a-visitor', intent);
    now = PROPOSAL_LAPSE_SECONDS * 1000 + 1;

    expect(proposals.held('a-visitor')).toBeNull();
  });

  it('keeps why a refused turn cannot be sent, so an ask afterwards has an answer', () => {
    const proposals = createProposals();
    proposals.refuse('a-visitor', 'that address is not one the investor listed');

    expect(proposals.held('a-visitor')).toBeNull();
    expect(proposals.refusal('a-visitor')).toContain('not one the investor listed');
  });

  it('keeps one or the other and never both, so a refusal cannot be sent', () => {
    const proposals = createProposals();
    proposals.keep('a-visitor', intent);
    proposals.refuse('a-visitor', 'the price is under the floor');

    expect(proposals.held('a-visitor')).toBeNull();
    expect(proposals.refusal('a-visitor')).toContain('under the floor');
  });

  it('forgets one that was sent, so it cannot be sent twice', () => {
    const proposals = createProposals();
    proposals.keep('a-visitor', intent);
    proposals.drop('a-visitor');

    expect(proposals.held('a-visitor')).toBeNull();
  });
});
