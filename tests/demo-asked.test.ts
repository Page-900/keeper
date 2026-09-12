import { describe, expect, it } from 'vitest';

import { asksToSend } from '../src/demo/asked.js';

describe('the words a visitor uses to ask for a send', () => {
  it('reads a plain instruction as an ask', () => {
    expect(asksToSend('execute it')).toBe(true);
    expect(asksToSend('Execute the transaction')).toBe(true);
    expect(asksToSend('send it')).toBe(true);
    expect(asksToSend('send the transfer')).toBe(true);
    expect(asksToSend('deliver it')).toBe(true);
    expect(asksToSend('do it')).toBe(true);
    expect(asksToSend('go ahead')).toBe(true);
    expect(asksToSend('yes, send')).toBe(true);
  });

  it('reads the ways a person actually says it, not one form word for word', () => {
    expect(asksToSend('proceed with executing the transaction')).toBe(true);
    expect(asksToSend('Proceed')).toBe(true);
    expect(asksToSend('please execute the transaction')).toBe(true);
    expect(asksToSend('executing it now is fine')).toBe(true);
    expect(asksToSend('sending it is what I want')).toBe(true);
    expect(asksToSend('settle it')).toBe(true);
    expect(asksToSend('transfer the tokens')).toBe(true);
    expect(asksToSend('sell it')).toBe(true);
    expect(asksToSend('make the transfer')).toBe(true);
    expect(asksToSend('put it on the chain')).toBe(true);
    expect(asksToSend('ship it')).toBe(true);
    expect(asksToSend('confirmed')).toBe(true);
    expect(asksToSend('approve it')).toBe(true);
  });

  it('reads a bare yes as the ask it is, because a proposal is already on the screen', () => {
    expect(asksToSend('yes')).toBe(true);
    expect(asksToSend('ok')).toBe(true);
    expect(asksToSend('go')).toBe(true);
    expect(asksToSend('yes please, send it')).toBe(true);
  });

  it('reads a document describing a settlement as no ask, because it never opens with the verb', () => {
    expect(asksToSend('We may proceed to settlement once the buyer is cleared')).toBe(false);
    expect(asksToSend('The seller will deliver the tokens on receipt')).toBe(false);
    expect(asksToSend('Harbour Lane confirms it holds 25 SUNL today')).toBe(false);
    expect(asksToSend('Settlement is made on delivery')).toBe(false);
  });

  it('finds the ask when it sits in a longer message', () => {
    expect(asksToSend('I have read your proposal. Go ahead and put it on the chain.')).toBe(true);
  });

  it('reads a refusal to send as no ask at all', () => {
    expect(asksToSend('do not execute it')).toBe(false);
    expect(asksToSend('never send it')).toBe(false);
    expect(asksToSend('hold off, do not send the transfer')).toBe(false);
    expect(asksToSend('cancel it, do not deliver this')).toBe(false);
  });

  it('reads a question about sending as no ask', () => {
    expect(asksToSend('would you execute it?')).toBe(false);
    expect(asksToSend('can you send it?')).toBe(false);
  });

  it('reads an ordinary document as no ask', () => {
    expect(asksToSend('Harbour Lane Partners will buy 200 SUNL at 47 BKN.')).toBe(false);
    expect(asksToSend('What do you make of this offer')).toBe(false);
    expect(asksToSend('')).toBe(false);
  });

  it('keeps the refusal to the clause it was written in', () => {
    expect(asksToSend('I do not like the price. Execute it anyway')).toBe(true);
  });
});
