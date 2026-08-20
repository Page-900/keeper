import { formatUnits, hashTypedData, type TypedDataDomain } from 'viem';

import {
  CHAIN_ID,
  MANDATE_ACTIONS,
  MANDATE_METADATA,
  MAX_CUMULATIVE_VALUE,
  MAX_TRANSACTION_VALUE,
  PERMITTED_ACTION,
  SIGNATURE_DEADLINE_SECONDS,
  SUNL_DECIMALS,
  SUNL_SYMBOL,
  identityRef,
  mandateWindow,
  requireAddress,
} from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';

export const GRANT_MANDATE_TYPES = {
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
} as const;

export type GrantMandateMessage = {
  agent: `0x${string}`;
  validFrom: number;
  validUntil: number;
  principal: `0x${string}`;
  complianceProvider: `0x${string}`;
  identityRef: `0x${string}`;
  asset: `0x${string}`;
  maxTransactionValue: bigint;
  maxCumulativeValue: bigint;
  metadata: `0x${string}`;
  actions: `0x${string}`[];
  nonce: bigint;
  deadline: bigint;
};

export function requireIdentityRef(slot: `0x${string}` | null = identityRef): `0x${string}` {
  if (slot === null) throw new KeeperError('identityRefUnissued', 'eligibility reference');
  return slot;
}

export const grantMandateDomain = (): TypedDataDomain => ({
  name: 'RAMS',
  version: '1',
  chainId: CHAIN_ID,
  verifyingContract: requireAddress('agentMandate'),
});

export function grantMandateMessage(input: {
  nowSeconds: number;
  nonce: bigint;
  identityRef: `0x${string}`;
}): GrantMandateMessage {
  const { validFrom, validUntil } = mandateWindow(input.nowSeconds);
  return {
    agent: requireAddress('agent'),
    validFrom,
    validUntil,
    principal: requireAddress('principal'),
    complianceProvider: requireAddress('complianceProvider'),
    identityRef: input.identityRef,
    asset: requireAddress('asset'),
    maxTransactionValue: MAX_TRANSACTION_VALUE,
    maxCumulativeValue: MAX_CUMULATIVE_VALUE,
    metadata: MANDATE_METADATA,
    actions: [...MANDATE_ACTIONS],
    nonce: input.nonce,
    deadline: BigInt(input.nowSeconds) + SIGNATURE_DEADLINE_SECONDS,
  };
}

export const grantMandateTypedData = (message: GrantMandateMessage) => ({
  domain: grantMandateDomain(),
  types: GRANT_MANDATE_TYPES,
  primaryType: 'GrantMandate' as const,
  message,
});

export const grantMandateDigest = (message: GrantMandateMessage): `0x${string}` =>
  hashTypedData(grantMandateTypedData(message));

export type MandateRow = { label: string; value: string };

const whole = (amount: bigint): string => `${formatUnits(amount, SUNL_DECIMALS)} ${SUNL_SYMBOL}`;

const utc = (seconds: number | bigint): string =>
  `${new Date(Number(seconds) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')} UTC`;

export const mandateSummary = (message: GrantMandateMessage): MandateRow[] => [
  { label: 'Who may act', value: message.agent },
  { label: 'Whose tokens it moves', value: message.principal },
  { label: 'Which token', value: `${SUNL_SYMBOL} at ${message.asset}` },
  { label: 'Most it may move at once', value: whole(message.maxTransactionValue) },
  { label: 'Most it may move in total, ever', value: whole(message.maxCumulativeValue) },
  { label: 'The only thing it may do', value: PERMITTED_ACTION.signature },
  { label: 'Starts', value: utc(message.validFrom) },
  { label: 'Ends', value: utc(message.validUntil) },
  { label: 'This signature is usable until', value: utc(message.deadline) },
  { label: 'Replay number it is signed against', value: String(message.nonce) },
];
