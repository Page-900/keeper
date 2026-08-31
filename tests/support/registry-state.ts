import type { RegistryRead } from '../../src/chain/registry.js';
import { CHAIN_ID, requireAddress } from '../../src/shared/config.js';

export const STATE_BLOCK = 11_558_500n;

export const PER_TRANSACTION = 250_000_000_000_000_000_000n;

export const STATE_TIME = 1_790_000_000n;

export const registryState = (overrides: Partial<RegistryRead> = {}): RegistryRead => ({
  at: '2026-08-25T00:00:00.000Z',
  chainId: CHAIN_ID,
  registry: requireAddress('agentMandate'),
  executor: requireAddress('executor'),
  principal: requireAddress('principal'),
  agent: requireAddress('agent'),
  blockNumber: String(STATE_BLOCK),
  blockTimestamp: String(STATE_TIME),
  mandateGranted: true,
  mandateValidFrom: '1787500000',
  mandateValidUntil: '1792773729',
  mandateAgent: requireAddress('agent'),
  mandatePrincipal: requireAddress('principal'),
  mandateAsset: requireAddress('asset'),
  mandateRevoked: false,
  maxTransactionValue: String(PER_TRANSACTION),
  maxCumulativeValue: String(PER_TRANSACTION * 4n),
  cumulativeUsed: String(PER_TRANSACTION),
  actionEnabled: true,
  agentFrozen: false,
  principalNonce: '1',
  principalEligible: true,
  eligibilityReason: 0,
  eligibilityExpiresAt: '0',
  executorMayRecord: true,
  ...overrides,
});
