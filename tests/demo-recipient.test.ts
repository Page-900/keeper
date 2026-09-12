import { describe, expect, it } from 'vitest';

import { addressIn, askAboutRecipient, type RecipientReads } from '../src/demo/recipient.js';
import { MAX_TRANSACTION_VALUE, requireAddress } from '../src/shared/config.js';
import { captureError } from './support/capture-error.js';

const AT = 11_673_400n;

const asking: { to?: string; amount?: bigint }[] = [];

const reads = (error: string | null): RecipientReads => ({
  block: () => Promise.resolve(AT),
  refusal: (action) => {
    asking.push({ to: action.to, amount: action.amount });
    return Promise.resolve(error === null ? null : { error, args: [] });
  },
});

const asked = (error: string | null, said = requireAddress('uncleared')) =>
  askAboutRecipient(said, reads(error));

describe('a visitor names the address, so the answer cannot have been arranged first', () => {
  it('asks about the address that was typed and about no other', async () => {
    const answer = await asked('RecipientNotAllowed');

    expect(answer.address).toBe(requireAddress('uncleared'));
    expect(answer.atBlock).toBe(String(AT));
  });

  it('always asks about the limit the mandate publishes, never an amount from the request', async () => {
    asking.length = 0;

    const answer = await asked(null);

    expect(asking).toEqual([{ to: requireAddress('uncleared'), amount: MAX_TRANSACTION_VALUE }]);
    expect(answer.amount).toBe(String(MAX_TRANSACTION_VALUE));
  });

  it('credits our own contract when it is the one that refused', async () => {
    const answer = await asked('RecipientNotAllowed');

    expect(answer.allowed).toBe(false);
    expect(answer.layer).toBe('app');
    expect(answer.says).toContain('this project');
  });

  it('credits the permission when the permission is what refused', async () => {
    const answer = await asked('CannotExecute');

    expect(answer.layer).toBe('mandate');
    expect(answer.says).toContain('permission');
  });

  it('credits the token when the token is what refused', async () => {
    const answer = await asked('CallFailed');

    expect(answer.layer).toBe('token');
  });

  it('refuses to guess a layer for a revert it does not know', async () => {
    const answer = await asked('SomethingNobodyHasSeen');

    expect(answer.layer).toBeNull();
    expect(answer.says).toContain('will not guess');
  });

  it('says plainly that a delivery would go through when nothing refuses it', async () => {
    const answer = await asked(null, requireAddress('counterparty'));

    expect(answer.allowed).toBe(true);
    expect(answer.refusal).toBeNull();
  });

  it('turns anything that is not an address away in plain words', async () => {
    for (const said of ['', '   ', 'not an address', '0x1234', 42, null]) {
      const error = await captureError(() => askAboutRecipient(said, reads(null)));
      expect(error.kind).toBe('requestUnusable');
    }
  });

  it('takes an address a visitor typed without capital letters', () => {
    expect(addressIn(requireAddress('uncleared').toLowerCase())).toBe(
      requireAddress('uncleared').toLowerCase(),
    );
  });

  it('says each fact once, so the answer does not repeat itself back at the reader', () => {
    const said = Object.values({
      app: 'Refused by this project, before the permission was asked.',
      mandate: 'Refused by the permission the investor granted.',
      token: 'Refused by the token itself.',
    });

    for (const one of said) {
      const words = one.toLowerCase().replace(/[.,]/g, '').split(' ');
      const repeated = words.filter((w, at) => w.length > 4 && words.indexOf(w) !== at);
      expect(repeated).toEqual([]);
    }
  });
});
