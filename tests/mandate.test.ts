import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  GRANT_MANDATE_TYPES,
  grantMandateDigest,
  grantMandateMessage,
  grantMandateTypedData,
  mandateSummary,
  requireIdentityRef,
} from '../src/chain/mandate.js';
import {
  MANDATE_ACTIONS,
  MAX_CUMULATIVE_VALUE,
  MAX_TRANSACTION_VALUE,
  requireAddress,
} from '../src/shared/config.js';
import { KeeperError } from '../src/shared/errors.js';

const NOW = 1_780_000_000;
const REF = `0x${'ab'.repeat(32)}` as const;

const message = (): ReturnType<typeof grantMandateMessage> =>
  grantMandateMessage({ nowSeconds: NOW, nonce: 0n, identityRef: REF });

const canonicalType = (): string =>
  `GrantMandate(${GRANT_MANDATE_TYPES.GrantMandate.map((f) => `${f.type} ${f.name}`).join(',')})`;

const solidityTypeString = (): string => {
  const source = readFileSync('contracts/test/ForkRehearsal.t.sol', 'utf8');
  const literals = source.slice(source.indexOf('GRANT_MANDATE_TYPEHASH')).match(/"([^"]*)"/g);
  return (literals ?? []).slice(0, 4).join('').replaceAll('"', '');
};

describe('the signed type is the one the registry hashes', () => {
  it('matches the type string the fork rehearsal proves the registry accepts', () => {
    expect(canonicalType()).toBe(solidityTypeString());
  });

  it('signs thirteen fields, so no cap or date can be added after signing', () => {
    expect(GRANT_MANDATE_TYPES.GrantMandate).toHaveLength(13);
  });
});

describe('the domain binds the signature to one registry on one chain', () => {
  it('names RAMS version 1 on Sepolia, at the deployed registry', () => {
    expect(grantMandateTypedData(message()).domain).toEqual({
      name: 'RAMS',
      version: '1',
      chainId: 11155111,
      verifyingContract: requireAddress('agentMandate'),
    });
  });
});

describe('the message carries the bound the investor is agreeing to', () => {
  it('carries both caps as base units', () => {
    expect(message().maxTransactionValue).toBe(MAX_TRANSACTION_VALUE);
    expect(message().maxCumulativeValue).toBe(MAX_CUMULATIVE_VALUE);
  });

  it('permits the one padded selector and nothing else', () => {
    expect(message().actions).toEqual([...MANDATE_ACTIONS]);
  });

  it('expires the signature before the mandate it grants', () => {
    expect(message().deadline).toBeLessThan(BigInt(message().validUntil));
  });

  it('names the agent and the principal as different wallets', () => {
    expect(message().agent).toBe(requireAddress('agent'));
    expect(message().principal).toBe(requireAddress('principal'));
  });
});

describe('the digest moves when the bound moves', () => {
  it('changes when the per-transaction cap changes', () => {
    const raised = { ...message(), maxTransactionValue: MAX_TRANSACTION_VALUE + 1n };
    expect(grantMandateDigest(raised)).not.toBe(grantMandateDigest(message()));
  });

  it('changes when the nonce changes, so a signature cannot be replayed', () => {
    const replayed = { ...message(), nonce: 1n };
    expect(grantMandateDigest(replayed)).not.toBe(grantMandateDigest(message()));
  });
});

describe('nothing is signed before Brickken issue the eligibility reference', () => {
  it('refuses while the reference is unissued, and says which value is missing', () => {
    expect(() => requireIdentityRef(null)).toThrow(KeeperError);
    expect(() => requireIdentityRef(null)).toThrow(/eligibility reference/);
  });

  it('returns the reference once one exists', () => {
    expect(requireIdentityRef(REF)).toBe(REF);
  });
});

const summary = (): ReturnType<typeof mandateSummary> => mandateSummary(message());

const valueOf = (label: string): string =>
  summary().find((row) => row.label === label)?.value ?? '';

describe('the bound reads in plain language, because the investor has to understand it', () => {
  it('states both caps in whole tokens and never in base units', () => {
    expect(valueOf('Most it may move at once')).toBe('250 SUNL');
    expect(valueOf('Most it may move in total, ever')).toBe('1000 SUNL');
  });

  it('names the wallet that may act and the wallet it acts for', () => {
    expect(valueOf('Who may act')).toBe(requireAddress('agent'));
    expect(valueOf('Whose tokens it moves')).toBe(requireAddress('principal'));
  });

  it('states the window as readable UTC, never as a raw timestamp', () => {
    expect(valueOf('Ends')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z UTC$/);
  });

  it('spells out the one call the agent may make', () => {
    expect(valueOf('The only thing it may do')).toContain('transferFrom');
  });

  it('says nothing the message does not carry', () => {
    expect(summary().every((row) => row.value.length > 0)).toBe(true);
  });
});
