import { getAddress } from 'viem';

import { KeeperError } from './errors.js';

/** Sepolia only. */
export const CHAIN_ID = 11155111;

export const BRICKKEN_API_BASE_URL = 'https://api.sandbox.brickken.com';

/** ERC-8226 reads type(uint256).max as unlimited, so a cap of zero is the strictest. */
export const UNCAPPED = 2n ** 256n - 1n;

export const SUNL_DECIMALS = 18;

const sunl = (whole: bigint): bigint => whole * 10n ** BigInt(SUNL_DECIMALS);

/** Deliberately low, so a successful attack on the public demo stays cheap. */
export const MAX_TRANSACTION_VALUE = sunl(1_000n);

/** Lifetime total across the whole window, never a monthly or rolling allowance. */
export const MAX_CUMULATIVE_VALUE = sunl(5_000n);

/** uint48 seconds, as the EIP defines it. */
export const MANDATE_WINDOW_SECONDS = 30 * 24 * 60 * 60;

export type AddressSlot = `0x${string}` | null;

export type AddressName =
  'principal' | 'agent' | 'asset' | 'executor' | 'agentMandate' | 'complianceProvider';

/** The only place a deployed address may live. */
export const addressSlots: Readonly<Record<AddressName, AddressSlot>> = Object.freeze({
  principal: null,
  agent: null,
  asset: null,
  executor: null,
  agentMandate: null,
  complianceProvider: null,
});

/** 32-byte eligibility reference issued with the principal's registration. */
export const identityRef: `0x${string}` | null = null;

/** Throws rather than yielding a zero address that reverts later. */
export function requireAddress(name: AddressName): `0x${string}` {
  const slot: AddressSlot = addressSlots[name];
  if (slot === null) throw new KeeperError('addressUnissued', `address slot "${name}"`);
  return getAddress(slot);
}
