import { getAddress, keccak256, pad, toFunctionSelector, toHex, zeroAddress, zeroHash } from 'viem';

import { KeeperError } from './errors.js';

export const CHAIN_ID = 11155111;

export const BRICKKEN_API_BASE_URL = 'https://api.sandbox.brickken.com';

export const BRICKKEN_MCP_URL = 'https://mcp.brickken.com/mcp';

const EXPLORER_BASE_URL = 'https://sepolia.etherscan.io';

export const explorerTransaction = (hash: string): string => `${EXPLORER_BASE_URL}/tx/${hash}`;

export const explorerAddress = (address: string): string =>
  `${EXPLORER_BASE_URL}/address/${address}`;

/** ERC-8226 reads type(uint256).max as unlimited, so a cap of zero is the strictest. */
export const UNCAPPED = 2n ** 256n - 1n;

export const NO_MANDATE_PRINCIPAL: `0x${string}` = zeroAddress;

export const SUNL_DECIMALS = 18;

const sunl = (whole: bigint): bigint => whole * 10n ** BigInt(SUNL_DECIMALS);

export const SUNL_NAME = 'Sunrise Lodge';

export const SUNL_SYMBOL = 'SUNL';

export const SUNL_TOKEN_TYPE = 'RWA_TOKEN';

export const SUNL_SUPPLY_WHOLE = 10_000n;

export const SUNL_SUPPLY = sunl(SUNL_SUPPLY_WHOLE);

/** Brickken require the holder's identity to differ from the issuer's, so it is invented. */
export const HOLDER_EMAIL = 'holder@example.com';

export const COUNTERPARTY_EMAIL = 'counterparty@example.com';

export const PRINCIPAL_HOLDING_WHOLE = 2_000n;

export const PRINCIPAL_HOLDING = sunl(PRINCIPAL_HOLDING_WHOLE);

export const OFFERING_AMOUNT_WHOLE = 1_000n;

export const OFFERING_AMOUNT = sunl(OFFERING_AMOUNT_WHOLE);

export const OFFERING_COIN = 'BKN';

export const OFFERING_MIN_RAISE_USD = 10_000n;

export const OFFERING_MAX_RAISE_USD = 50_000n;

export const OFFERING_MIN_INVESTMENT = 100n;

export const OFFERING_MAX_INVESTMENT = 25_000n;

export const OFFERING_MAX_RUN_DAYS = 7;

const OFFERING_STARTS_IN_SECONDS = 30 * 60;

const OFFERING_RUNS_FOR_SECONDS = 7 * 24 * 60 * 60;

export interface OfferingWindow {
  startDate: string;
  endDate: string;
}

export function offeringWindow(
  nowMs: number,
  startsIn = OFFERING_STARTS_IN_SECONDS,
  runsFor = OFFERING_RUNS_FOR_SECONDS,
): OfferingWindow {
  const at = (seconds: number): string => new Date(nowMs + seconds * 1000).toISOString();
  return { startDate: at(startsIn), endDate: at(startsIn + runsFor) };
}

/** Deliberately low, so a successful attack on the public demo stays cheap. */
export const MAX_TRANSACTION_VALUE = sunl(250n);

/** Lifetime total across the whole window, never a monthly or rolling allowance. */
export const MAX_CUMULATIVE_VALUE = sunl(1_000n);

export const MANDATE_WINDOW_SECONDS = 60 * 24 * 60 * 60;

export const MANDATE_MUST_HOLD_UNTIL_ISO = '2026-09-30T23:59:59Z';

export const MANDATE_MUST_HOLD_UNTIL = BigInt(Date.parse(MANDATE_MUST_HOLD_UNTIL_ISO) / 1000);

export const SIGNATURE_DEADLINE_SECONDS = 60n * 60n;

export const MANDATE_METADATA = zeroHash;

export type MandateWindow = { validFrom: number; validUntil: number };

export interface MandateSpec {
  agent: AddressName;
  maxTransactionValue: bigint;
  maxCumulativeValue: bigint;
  opensIn: number;
  runsFor: number;
}

export const KEEPER_MANDATE: MandateSpec = Object.freeze({
  agent: 'agent',
  maxTransactionValue: MAX_TRANSACTION_VALUE,
  maxCumulativeValue: MAX_CUMULATIVE_VALUE,
  opensIn: 0,
  runsFor: MANDATE_WINDOW_SECONDS,
});

const PROBE_OPENS_IN_SECONDS = 15 * 60;

const PROBE_RUNS_FOR_SECONDS = 45 * 60;

export const PROBE_MANDATE: MandateSpec = Object.freeze({
  agent: 'probe',
  maxTransactionValue: sunl(1n),
  maxCumulativeValue: sunl(2n),
  opensIn: PROBE_OPENS_IN_SECONDS,
  runsFor: PROBE_RUNS_FOR_SECONDS,
});

/** grantMandate reverts InvalidExpiry unless validUntil is past both now and validFrom. */
export function specWindow(spec: MandateSpec, nowSeconds: number): MandateWindow {
  const validFrom = nowSeconds + spec.opensIn;
  return { validFrom, validUntil: validFrom + spec.runsFor };
}

const TRANSFER_FROM = 'transferFrom(address,address,uint256)';

/** The transfer the executor forwards. The amount is its third argument, so the index is 2. */
export const PERMITTED_ACTION = Object.freeze({
  signature: TRANSFER_FROM,
  selector: toFunctionSelector(TRANSFER_FROM),
  supported: true,
  hasAmount: true,
  amountIndex: 2,
});

/** The executor labels the action bytes32(selector), and that cast pads on the right. */
export const TRANSFER_ACTION: `0x${string}` = pad(PERMITTED_ACTION.selector, {
  dir: 'right',
  size: 32,
});

export const MANDATE_ACTIONS: readonly `0x${string}`[] = Object.freeze([TRANSFER_ACTION]);

const APPROVE = 'approve(address,uint256)';

export const SECOND_ACTION = Object.freeze({
  signature: APPROVE,
  selector: toFunctionSelector(APPROVE),
  supported: true,
  hasAmount: true,
  amountIndex: 1,
});

export const SECOND_ACTION_ID: `0x${string}` = pad(SECOND_ACTION.selector, {
  dir: 'right',
  size: 32,
});

export type AddressSlot = `0x${string}` | null;

export type AddressName =
  | 'counterparty'
  | 'principal'
  | 'agent'
  | 'probe'
  | 'uncleared'
  | 'asset'
  | 'executor'
  | 'agentMandate'
  | 'complianceProvider';

export const addressSlots: Readonly<Record<AddressName, AddressSlot>> = Object.freeze({
  counterparty: '0xd34B78Ff018835b7124FCf347a319A788d2DC71E',
  principal: '0x6EF3A7D250F3E7e04Cf8B64E950FB1f8225832Dc',
  agent: '0x29d78c8c5E7ad231a21A64170cA07e419f0C5aBa',
  probe: '0xB74a98a9e33d13874adec7919BFe6599DD70161a',
  uncleared: '0x3Fb193fB1b205d3d5c258D907c2E3D259CE00521',
  asset: '0x2ae3bb75ab04957ae3b8944094bc9e96d33db255',
  executor: '0x914f32af870b11739c68cbc8c4561c139a820c41',
  agentMandate: '0xD68E1bb972cA4EF7F5764FBf6d685a6DfC26778e',
  complianceProvider: '0xa90D2503D5D9b80ECC27856Ff76F892B8C02f278',
});

/** recordExecution is refused unless the caller holds this role, which only Brickken can grant. */
export const RECORDER_ROLE = keccak256(toHex('RECORDER_ROLE'));

/** Issued by Brickken with the principal's compliance record, and used exactly as issued. */
export const identityRef: `0x${string}` =
  '0x59d0004b514dbb6948b1b54ba9dbf20767d8f9a87925cfd65ea3419ebca512e0';

export function addressNamed(address: string): AddressName | null {
  const wanted = address.toLowerCase();
  for (const [name, slot] of Object.entries(addressSlots) as [AddressName, AddressSlot][]) {
    if (slot !== null && slot.toLowerCase() === wanted) return name;
  }
  return null;
}

/** Throws rather than yielding a zero address that reverts later. */
export function requireAddress(
  name: AddressName,
  slots: Readonly<Record<AddressName, AddressSlot>> = addressSlots,
): `0x${string}` {
  const slot: AddressSlot = slots[name];
  if (slot === null) throw new KeeperError('addressUnissued', `address slot "${name}"`);
  return getAddress(slot);
}
