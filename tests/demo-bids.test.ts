import { describe, expect, it } from 'vitest';

import { listBids, readBid } from '../src/demo/bids.js';
import { MAX_DOCUMENT_CHARACTERS } from '../src/demo/limits.js';
import { captureError } from './support/capture-error.js';

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

    expect(error.kind).toBe('brickkenUnreadable');
  });

  it('refuses a file that opens without a summary, so no card says nothing', async () => {
    const error = await captureError(() =>
      Promise.resolve(readBid('# only a title\n\nbody', 'wordless')),
    );

    expect(error.kind).toBe('brickkenUnreadable');
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
