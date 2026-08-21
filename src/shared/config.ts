import { getAddress, pad, toFunctionSelector, zeroHash } from 'viem';

import { KeeperError } from './errors.js';

export const CHAIN_ID = 11155111;

export const BRICKKEN_API_BASE_URL = 'https://api.sandbox.brickken.com';

const EXPLORER_BASE_URL = 'https://sepolia.etherscan.io';

export const explorerTransaction = (hash: string): string => `${EXPLORER_BASE_URL}/tx/${hash}`;

export const explorerAddress = (address: string): string =>
  `${EXPLORER_BASE_URL}/address/${address}`;

/** ERC-8226 reads type(uint256).max as unlimited, so a cap of zero is the strictest. */
export const UNCAPPED = 2n ** 256n - 1n;

export const SUNL_DECIMALS = 18;

const sunl = (whole: bigint): bigint => whole * 10n ** BigInt(SUNL_DECIMALS);

export const SUNL_NAME = 'Sunrise Lodge';

export const SUNL_SYMBOL = 'SUNL';

export const SUNL_TOKEN_TYPE = 'RWA_TOKEN';

export const SUNL_SUPPLY_WHOLE = 10_000n;

export const SUNL_SUPPLY = sunl(SUNL_SUPPLY_WHOLE);

/** Brickken require the holder's identity to differ from the issuer's, so it is invented. */
export const HOLDER_EMAIL = 'holder@example.com';

export const PRINCIPAL_HOLDING_WHOLE = 2_000n;

export const PRINCIPAL_HOLDING = sunl(PRINCIPAL_HOLDING_WHOLE);

/** Deliberately low, so a successful attack on the public demo stays cheap. */
export const MAX_TRANSACTION_VALUE = sunl(250n);

/** Lifetime total across the whole window, never a monthly or rolling allowance. */
export const MAX_CUMULATIVE_VALUE = sunl(1_000n);

/** uint48 seconds, as the EIP defines it. */
export const MANDATE_WINDOW_SECONDS = 60 * 24 * 60 * 60;

export const MANDATE_MUST_HOLD_UNTIL_ISO = '2026-09-30T23:59:59Z';

export const MANDATE_MUST_HOLD_UNTIL = BigInt(Date.parse(MANDATE_MUST_HOLD_UNTIL_ISO) / 1000);

export const SIGNATURE_DEADLINE_SECONDS = 60n * 60n;

export const MANDATE_METADATA = zeroHash;

export type MandateWindow = { validFrom: number; validUntil: number };

/** grantMandate reverts InvalidExpiry unless validUntil is past both now and validFrom. */
export function mandateWindow(nowSeconds: number): MandateWindow {
  return { validFrom: nowSeconds, validUntil: nowSeconds + MANDATE_WINDOW_SECONDS };
}

const TRANSFER_FROM = 'transferFrom(address,address,uint256)';

/** The only call the executor forwards. The amount is its third argument, so the index is 2. */
export const PERMITTED_ACTION = Object.freeze({
  signature: TRANSFER_FROM,
  selector: toFunctionSelector(TRANSFER_FROM),
  supported: true,
  hasAmount: true,
  amountIndex: 2,
});

/** The executor labels the action bytes32(selector), and that cast pads on the right. */
export const MANDATE_ACTIONS: readonly `0x${string}`[] = Object.freeze([
  pad(PERMITTED_ACTION.selector, { dir: 'right', size: 32 }),
]);

export type AddressSlot = `0x${string}` | null;

export type AddressName =
  'principal' | 'agent' | 'asset' | 'executor' | 'agentMandate' | 'complianceProvider';

export const addressSlots: Readonly<Record<AddressName, AddressSlot>> = Object.freeze({
  principal: '0x6EF3A7D250F3E7e04Cf8B64E950FB1f8225832Dc',
  agent: '0x29d78c8c5E7ad231a21A64170cA07e419f0C5aBa',
  asset: '0x2ae3bb75ab04957ae3b8944094bc9e96d33db255',
  executor: '0x914f32af870b11739c68cbc8c4561c139a820c41',
  agentMandate: '0xD68E1bb972cA4EF7F5764FBf6d685a6DfC26778e',
  complianceProvider: '0xa90D2503D5D9b80ECC27856Ff76F892B8C02f278',
});

/** 32-byte eligibility reference issued with the principal's registration. */
export const identityRef: `0x${string}` | null = null;

/** Throws rather than yielding a zero address that reverts later. */
export function requireAddress(
  name: AddressName,
  slots: Readonly<Record<AddressName, AddressSlot>> = addressSlots,
): `0x${string}` {
  const slot: AddressSlot = slots[name];
  if (slot === null) throw new KeeperError('addressUnissued', `address slot "${name}"`);
  return getAddress(slot);
}
