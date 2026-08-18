import { describe, expect, it } from 'vitest';

import {
  CHAIN_ID,
  MANDATE_WINDOW_SECONDS,
  MAX_CUMULATIVE_VALUE,
  MAX_TRANSACTION_VALUE,
  PRINCIPAL_HOLDING,
  PERMITTED_ACTION,
  SUNL_SUPPLY,
  UNCAPPED,
  addressSlots,
  requireAddress,
  type AddressName,
} from '../src/shared/config.js';

describe('chain', () => {
  it('targets Sepolia and nothing else', () => {
    expect(CHAIN_ID).toBe(11155111);
  });
});

describe('unlimited is type(uint256).max, not zero', () => {
  it('spells the sentinel out as 2^256 - 1', () => {
    expect(UNCAPPED).toBe(2n ** 256n - 1n);
  });

  it('agrees with the 32-byte all-ones word', () => {
    expect(UNCAPPED).toBe(BigInt(`0x${'f'.repeat(64)}`));
  });

  it('is not zero, because a cap of zero permits nothing', () => {
    expect(UNCAPPED).not.toBe(0n);
  });
});

describe('demo mandate caps', () => {
  it('keeps both caps below the sentinel, or the cap we exist to prove is disabled', () => {
    expect(MAX_TRANSACTION_VALUE).toBeLessThan(UNCAPPED);
    expect(MAX_CUMULATIVE_VALUE).toBeLessThan(UNCAPPED);
  });

  it('keeps both caps above zero, or every action reverts and looks like a broken build', () => {
    expect(MAX_TRANSACTION_VALUE).toBeGreaterThan(0n);
    expect(MAX_CUMULATIVE_VALUE).toBeGreaterThan(0n);
  });

  it('lets a single transaction spend less than the lifetime total', () => {
    expect(MAX_TRANSACTION_VALUE).toBeLessThan(MAX_CUMULATIVE_VALUE);
  });

  it('keeps every cap under what the principal holds, or no cap can ever be reached', () => {
    expect(MAX_TRANSACTION_VALUE).toBeLessThan(PRINCIPAL_HOLDING);
    expect(MAX_CUMULATIVE_VALUE).toBeLessThan(PRINCIPAL_HOLDING);
  });

  it('leaves the balance above the lifetime cap, so a refusal is the mandate and not an empty wallet', () => {
    expect(PRINCIPAL_HOLDING).toBeGreaterThan(MAX_CUMULATIVE_VALUE);
    expect(PRINCIPAL_HOLDING).toBeLessThanOrEqual(SUNL_SUPPLY);
  });

  it('carries every amount as bigint', () => {
    expect(typeof MAX_TRANSACTION_VALUE).toBe('bigint');
    expect(typeof MAX_CUMULATIVE_VALUE).toBe('bigint');
  });

  it('fits a short window into uint48 seconds', () => {
    expect(MANDATE_WINDOW_SECONDS).toBeGreaterThan(0);
    expect(MANDATE_WINDOW_SECONDS).toBeLessThan(2 ** 48 - 1);
  });
});

const UNISSUED: AddressName[] = ['asset'];

describe('address slots, empty until onboarding issues them or a deploy fills them', () => {
  it('leaves every slot nothing has issued empty rather than zero-filled', () => {
    for (const name of UNISSUED) {
      expect(addressSlots[name], `slot ${name} should be empty`).toBeNull();
    }
  });

  it('keeps the agent off the principal wallet, which is what the whole demonstration rests on', () => {
    expect(requireAddress('agent')).not.toBe(requireAddress('principal'));
  });

  it('holds the contracts that were read off the chain, and the one this project deployed', () => {
    expect(requireAddress('agentMandate')).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(requireAddress('complianceProvider')).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(requireAddress('executor')).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('fails closed on an unissued slot instead of returning a zero address', () => {
    expect(() => requireAddress('asset')).toThrow(/asset/);
  });

  it('refuses a runtime write rather than accepting a repointed executor', () => {
    const deployed = requireAddress('executor');

    expect(Object.isFrozen(addressSlots)).toBe(true);
    expect(Reflect.set(addressSlots, 'executor', `0x${'ad'.repeat(20)}`)).toBe(false);
    expect(requireAddress('executor')).toBe(deployed);
  });
});

describe('the one action the executor may forward', () => {
  it('computes the transferFrom selector rather than trusting a copied one', () => {
    expect(PERMITTED_ACTION.selector).toBe('0x23b872dd');
    expect(PERMITTED_ACTION.signature).toBe('transferFrom(address,address,uint256)');
  });

  it('reads the amount from the third argument, where transferFrom carries it', () => {
    expect(PERMITTED_ACTION.amountIndex).toBe(2);
    expect(PERMITTED_ACTION.hasAmount).toBe(true);
  });

  it('gates on an amount, or the cap is switched off while every check still passes', () => {
    expect(PERMITTED_ACTION.hasAmount).not.toBe(false);
    expect(Object.isFrozen(PERMITTED_ACTION)).toBe(true);
  });
});
