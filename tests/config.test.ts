import { describe, expect, it } from 'vitest';

import {
  CHAIN_ID,
  MANDATE_WINDOW_SECONDS,
  MAX_CUMULATIVE_VALUE,
  MAX_TRANSACTION_VALUE,
  UNCAPPED,
  addressSlots,
  requireAddress,
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

  it('carries every amount as bigint', () => {
    expect(typeof MAX_TRANSACTION_VALUE).toBe('bigint');
    expect(typeof MAX_CUMULATIVE_VALUE).toBe('bigint');
  });

  it('fits a short window into uint48 seconds', () => {
    expect(MANDATE_WINDOW_SECONDS).toBeGreaterThan(0);
    expect(MANDATE_WINDOW_SECONDS).toBeLessThan(2 ** 48 - 1);
  });
});

describe('address slots, empty until onboarding issues them', () => {
  it('starts every slot empty rather than zero-filled', () => {
    for (const [name, value] of Object.entries(addressSlots)) {
      expect(value, `slot ${name} should be empty`).toBeNull();
    }
  });

  it('fails closed on an unissued slot instead of returning a zero address', () => {
    expect(() => requireAddress('executor')).toThrow(/executor/);
  });

  it('refuses a runtime write rather than accepting a repointed executor', () => {
    expect(Object.isFrozen(addressSlots)).toBe(true);
    expect(Reflect.set(addressSlots, 'executor', `0x${'ad'.repeat(20)}`)).toBe(false);
    expect(addressSlots.executor).toBeNull();
  });
});
