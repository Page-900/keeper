import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import { hashParts, proposal } from '../public/ui.js';
import { growBox } from '../public/chat.js';

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

describe('the box a visitor writes in is never too small to read', () => {
  const sized = (scrollHeight: number): string => {
    const box = { scrollHeight, style: { height: '' } };
    growBox(box);
    return box.style.height;
  };

  it('holds a floor, so a short bid does not collapse it to one line', () => {
    expect(sized(18)).toBe('132px');
  });

  it('grows to fit a document that needs the room', () => {
    expect(sized(180)).toBe('180px');
  });

  it('stops at a ceiling, so a long document scrolls rather than taking the page', () => {
    expect(sized(4000)).toBe('240px');
  });
});

describe('a transaction hash on the page is something a judge can click', () => {
  const HASH = `0x${'ab'.repeat(32)}`;

  it('turns a hash inside a sentence into its own part, and leaves the words alone', () => {
    const parts = hashParts(`Sent. 25 SUNL in transaction ${HASH}. Done.`);

    expect(parts.map((part) => part.hash)).toEqual([null, HASH, null]);
    expect(parts[0]?.said).toBe('Sent. 25 SUNL in transaction ');
    expect(parts[2]?.said).toBe('. Done.');
  });

  it('shortens what it shows, so a long hash does not break the line', () => {
    const [part] = hashParts(HASH);

    expect(part?.said).toBe('0xabababab...ababab');
    expect(part?.hash).toBe(HASH);
  });

  it('finds every hash, because a send and its return are two', () => {
    const other = `0x${'cd'.repeat(32)}`;
    const parts = hashParts(`Sent in ${HASH} and returned in ${other}.`);

    expect(parts.filter((part) => part.hash !== null).map((part) => part.hash)).toEqual([
      HASH,
      other,
    ]);
  });

  it('leaves text with no hash in it as one plain part', () => {
    expect(hashParts('Execute is off, so nothing was sent.')).toEqual([
      { said: 'Execute is off, so nothing was sent.', hash: null },
    ]);
  });

  it('is what the agent answer and every card are rendered through', () => {
    const ui = readFileSync(new URL('../public/ui.js', import.meta.url), 'utf8');

    expect(ui).toContain("linked(el('p'), line.trim())");
    expect(ui).toContain("linked(el('p'), text)");
  });
});
