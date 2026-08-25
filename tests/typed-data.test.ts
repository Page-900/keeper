import { describe, expect, it } from 'vitest';

import { grantMandateDomain, grantMandateMessage } from '../src/chain/mandate.js';
import { readTypedData, requireSamePayload } from '../src/brickken/typed-data.js';
import { identityRef } from '../src/shared/config.js';
import { captureError } from './support/capture-error.js';

const NOW = 1_787_588_960;

const ours = () => grantMandateMessage({ nowSeconds: NOW, nonce: 0n, identityRef });

const theirs = (overrides: Record<string, unknown> = {}): unknown => {
  const message = ours();
  return {
    typedData: {
      domain: {
        name: 'RAMS',
        version: '1',
        chainId: '11155111',
        verifyingContract: '0xD68E1bb972cA4EF7F5764FBf6d685a6DfC26778e',
      },
      primaryType: 'GrantMandate',
      types: {
        GrantMandate: [
          { name: 'agent', type: 'address' },
          { name: 'validFrom', type: 'uint48' },
          { name: 'validUntil', type: 'uint48' },
          { name: 'principal', type: 'address' },
          { name: 'complianceProvider', type: 'address' },
          { name: 'identityRef', type: 'bytes32' },
          { name: 'asset', type: 'address' },
          { name: 'maxTransactionValue', type: 'uint256' },
          { name: 'maxCumulativeValue', type: 'uint256' },
          { name: 'metadata', type: 'bytes32' },
          { name: 'actions', type: 'bytes32[]' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      message: {
        agent: message.agent,
        validFrom: message.validFrom,
        validUntil: message.validUntil,
        principal: message.principal,
        complianceProvider: message.complianceProvider,
        identityRef: message.identityRef,
        asset: message.asset,
        maxTransactionValue: String(message.maxTransactionValue),
        maxCumulativeValue: String(message.maxCumulativeValue),
        metadata: message.metadata,
        actions: [...message.actions],
        nonce: String(message.nonce),
        deadline: String(message.deadline),
        ...overrides,
      },
    },
  };
};

const check = (body: unknown): `0x${string}` =>
  requireSamePayload(ours(), grantMandateDomain(), readTypedData(body));

describe('the payload Brickken hand back is held against the one this project built', () => {
  it('agrees on every field and returns the digest they both describe', () => {
    expect(check(theirs())).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('refuses a raised per-transaction cap and names the field', async () => {
    const error = await captureError(() =>
      Promise.resolve(check(theirs({ maxTransactionValue: '9999000000000000000000' }))),
    );

    expect(error.kind).toBe('payloadMismatch');
    expect(error.detail).toContain('maxTransactionValue');
  });

  it('refuses a different agent, which is the field that decides who may act', async () => {
    const error = await captureError(() =>
      Promise.resolve(check(theirs({ agent: '0x000000000000000000000000000000000000dead' }))),
    );

    expect(error.detail).toContain('agent');
  });

  it('refuses a stretched window', async () => {
    const error = await captureError(() =>
      Promise.resolve(check(theirs({ validUntil: NOW + 3_650 * 86_400 }))),
    );

    expect(error.detail).toContain('validUntil');
  });

  it('refuses a second action smuggled into the list', async () => {
    const extra = `0x${'ab'.repeat(32)}`;
    const error = await captureError(() => Promise.resolve(check(theirs({ actions: [extra] }))));

    expect(error.detail).toContain('actions');
  });

  it('refuses an identity reference that is not the one Brickken issued', async () => {
    const error = await captureError(() =>
      Promise.resolve(check(theirs({ identityRef: `0x${'11'.repeat(32)}` }))),
    );

    expect(error.detail).toContain('identityRef');
  });
});

describe('a payload is only read when it is the shape the standard defines', () => {
  it('refuses a body carrying no typed data at all', async () => {
    const error = await captureError(() => Promise.resolve(check({})));

    expect(error.kind).toBe('brickkenUnreadable');
  });

  it('refuses typed data for another operation', async () => {
    const body = theirs() as { typedData: { primaryType: string } };
    body.typedData.primaryType = 'RevokeMandate';

    const error = await captureError(() => Promise.resolve(check(body)));

    expect(error.detail).toContain('RevokeMandate');
  });

  it('refuses a field list that is not the one the registry hashes', async () => {
    const body = theirs() as { typedData: { types: { GrantMandate: unknown[] } } };
    body.typedData.types.GrantMandate.pop();

    const error = await captureError(() => Promise.resolve(check(body)));

    expect(error.kind).toBe('payloadMismatch');
  });

  it('refuses an extra domain field the field walk does not know to look at', async () => {
    const body = theirs() as { typedData: { domain: Record<string, unknown> } };
    body.typedData.domain['salt'] = `0x${'22'.repeat(32)}`;

    const error = await captureError(() => Promise.resolve(check(body)));

    expect(error.detail).toContain('the digest');
  });

  it('refuses a domain naming another verifying contract', async () => {
    const body = theirs() as { typedData: { domain: { verifyingContract: string } } };
    body.typedData.domain.verifyingContract = '0x000000000000000000000000000000000000dead';

    const error = await captureError(() => Promise.resolve(check(body)));

    expect(error.detail).toContain('verifyingContract');
  });
});
