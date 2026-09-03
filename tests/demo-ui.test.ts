import { describe, expect, it } from 'vitest';

import { proposal } from '../public/ui.js';

const DELIVER = {
  action: 'deliver',
  amount: '250000000000000000000',
  pricePerToken: '47',
  recipient: '0xd34B78Ff018835b7124FCf347a319A788d2DC71E',
};

describe('the log reads a turn that proposed nothing, because silence is an answer', () => {
  it('says so in words rather than throwing on a missing proposal', () => {
    expect(proposal(null)).toContain('without proposing');
  });

  it('still reads a delivery in whole tokens', () => {
    expect(proposal(DELIVER)).toContain('250 SUNL');
  });

  it('reads a decline without inventing an amount', () => {
    expect(proposal({ ...DELIVER, action: 'decline' })).toBe('It proposed to sell nothing.');
  });
});
