import { describe, expect, it } from 'vitest';

import {
  BRICKKEN_API_BASE_URL,
  CHAIN_ID,
  MANDATE_ACTIONS,
  MANDATE_METADATA,
  MANDATE_MUST_HOLD_UNTIL,
  MANDATE_MUST_HOLD_UNTIL_ISO,
  MANDATE_WINDOW_SECONDS,
  KEEPER_MANDATE,
  PROBE_MANDATE,
  SIGNATURE_DEADLINE_SECONDS,
  specWindow,
  MAX_CUMULATIVE_VALUE,
  MAX_TRANSACTION_VALUE,
  PRINCIPAL_HOLDING,
  PERMITTED_ACTION,
  SUNL_DECIMALS,
  SUNL_SUPPLY,
  UNCAPPED,
  addressSlots,
  requireAddress,
  type AddressName,
  SECOND_ACTION,
  SECOND_ACTION_ID,
  TRANSFER_ACTION,
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

  it('carries the window as a number, because uint48 seconds fit one exactly', () => {
    expect(Number.isSafeInteger(MANDATE_WINDOW_SECONDS)).toBe(true);
  });
});

const NOW = 1_780_000_000;

describe('the validity window, measured where grantMandate actually reverts', () => {
  it('puts validUntil past the current time, which is half of InvalidExpiry', () => {
    expect(specWindow(KEEPER_MANDATE, NOW).validUntil).toBeGreaterThan(NOW);
  });

  it('puts validUntil past validFrom, which is the other half', () => {
    const { validFrom, validUntil } = specWindow(KEEPER_MANDATE, NOW);
    expect(validUntil).toBeGreaterThan(validFrom);
  });

  it('keeps the whole window inside uint48 seconds', () => {
    expect(specWindow(KEEPER_MANDATE, NOW).validUntil).toBeLessThan(2 ** 48 - 1);
  });

  it('starts the mandate at the moment it is signed', () => {
    expect(specWindow(KEEPER_MANDATE, NOW).validFrom).toBe(NOW);
  });

  it('reaches past the date the demo has to survive to, from any day it is granted', () => {
    const lastDayItCouldBeGranted = Number(MANDATE_MUST_HOLD_UNTIL);
    expect(BigInt(specWindow(KEEPER_MANDATE, lastDayItCouldBeGranted).validUntil)).toBeGreaterThan(
      MANDATE_MUST_HOLD_UNTIL,
    );
  });

  it('reads the required date as the end of September in UTC', () => {
    expect(MANDATE_MUST_HOLD_UNTIL_ISO).toBe('2026-09-30T23:59:59Z');
    expect(MANDATE_MUST_HOLD_UNTIL).toBe(BigInt(Date.parse(MANDATE_MUST_HOLD_UNTIL_ISO) / 1000));
  });
});

describe('the signed action, as the executor labels it', () => {
  it('pads the selector to 32 bytes on the right, the way bytes32(selector) casts', () => {
    expect(MANDATE_ACTIONS).toEqual([`${PERMITTED_ACTION.selector}${'0'.repeat(56)}`]);
  });

  it('grants exactly one action, because the executor forwards exactly one call', () => {
    expect(MANDATE_ACTIONS).toHaveLength(1);
  });
});

describe('the optional metadata pointer', () => {
  it('stays empty, because no off-chain legal text is published to point at', () => {
    expect(MANDATE_METADATA).toBe(`0x${'0'.repeat(64)}`);
  });
});

describe('the signature deadline is not the mandate lifetime', () => {
  it('expires the signature long before the mandate it grants', () => {
    expect(SIGNATURE_DEADLINE_SECONDS).toBeLessThan(BigInt(MANDATE_WINDOW_SECONDS));
  });
});

const whole = (value: bigint): bigint => value / 10n ** BigInt(SUNL_DECIMALS);

describe("the investor's mandate is what the demonstration spends, so it is pinned", () => {
  it('still carries the granted caps, which no anchor may be allowed to outgrow', () => {
    expect(whole(KEEPER_MANDATE.maxTransactionValue)).toBe(250n);
    expect(whole(KEEPER_MANDATE.maxCumulativeValue)).toBe(1_000n);
  });

  it('opens immediately, because a granted mandate has no waiting period', () => {
    expect(KEEPER_MANDATE.opensIn).toBe(0);
    expect(KEEPER_MANDATE.runsFor).toBe(MANDATE_WINDOW_SECONDS);
  });

  it('is signed for by a different wallet than the probe mandate', () => {
    expect(KEEPER_MANDATE.agent).not.toBe(PROBE_MANDATE.agent);
  });
});

describe('the probe mandate exists to be spent, so it must be cheap and reachable', () => {
  it('costs a rounding error of the holding to exhaust', () => {
    expect(PROBE_MANDATE.maxCumulativeValue * 100n).toBeLessThan(PRINCIPAL_HOLDING);
  });

  it('leaves room for more than one legal transfer before the lifetime cap binds', () => {
    expect(PROBE_MANDATE.maxTransactionValue).toBeLessThan(PROBE_MANDATE.maxCumulativeValue);
  });

  it('opens later than now, which is the only way to act before the window', () => {
    expect(PROBE_MANDATE.opensIn).toBeGreaterThan(0);
  });

  it('closes inside one working session, so the expiry can be reached on purpose', () => {
    expect(PROBE_MANDATE.runsFor).toBeLessThan(2 * 60 * 60);
  });

  it('derives a window that grantMandate accepts, opening later and closing after', () => {
    const now = 1_800_000_000;
    const window = specWindow(PROBE_MANDATE, now);

    expect(window.validFrom).toBeGreaterThan(now);
    expect(window.validUntil).toBeGreaterThan(window.validFrom);
  });
});

const SLOTS = Object.keys(addressSlots) as AddressName[];

describe('address slots, empty until onboarding issues them or a deploy fills them', () => {
  it('holds a real address in every slot, and never a zero-filled one', () => {
    for (const name of SLOTS) {
      expect(addressSlots[name], `slot ${name}`).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(BigInt(addressSlots[name] ?? '0x0'), `slot ${name}`).not.toBe(0n);
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
    const unissued = { ...addressSlots, asset: null };

    expect(() => requireAddress('asset', unissued)).toThrow(/asset/);
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

describe('every call this project makes goes to the sandbox, never to the live platform', () => {
  it('names the sandbox host, so no edit can retarget a write without failing here', () => {
    expect(BRICKKEN_API_BASE_URL).toBe('https://api.sandbox.brickken.com');
  });

  it('keeps the host on its own subdomain, so a live host cannot pass as a sandbox one', () => {
    const { protocol, hostname } = new URL(BRICKKEN_API_BASE_URL);

    expect(protocol).toBe('https:');
    expect(hostname.startsWith('api.sandbox.')).toBe(true);
  });
});

describe('the second action exists so the mandate can be the only thing refusing it', () => {
  it('is never one of the actions a mandate enables', () => {
    expect(MANDATE_ACTIONS).not.toContain(SECOND_ACTION_ID);
  });

  it('reads its amount from the argument approve actually puts it in', () => {
    expect(SECOND_ACTION.amountIndex).toBe(1);
    expect(SECOND_ACTION.signature).toBe('approve(address,uint256)');
  });

  it('is a different action from the transfer, or it would prove nothing', () => {
    expect(SECOND_ACTION_ID).not.toBe(TRANSFER_ACTION);
  });
});
