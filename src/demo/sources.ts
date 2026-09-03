import { composeCapTable } from '../captable.js';
import { createBrickkenClient } from '../brickken/client.js';
import { mandateQuery } from '../brickken/grant.js';
import { readTokenBalance } from '../chain/client.js';
import { readRegistryState } from '../chain/registry.js';
import { KEEPER_MANDATE, requireAddress } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import type { DemoSources, RamsStatus } from './server.js';

const WHOLE = /^\d+$/;

/** Their status endpoint publishes the frozen flag and the replay number, and nothing else. */
export function asRamsStatus(body: unknown): RamsStatus {
  const found = (body ?? {}) as Record<string, unknown>;
  const nonce = found['nonce'];
  if (typeof found['isFrozen'] !== 'boolean')
    throw new KeeperError('brickkenUnreadable', 'GET /rams/status said nothing about freezing');
  if (typeof nonce !== 'string' || !WHOLE.test(nonce))
    throw new KeeperError('brickkenUnreadable', 'GET /rams/status gave no replay number');
  return { isFrozen: found['isFrozen'], nonce };
}

export const liveSources = (): DemoSources => ({
  reads: {
    state: () => readRegistryState(),
    balance: (holder, atBlock) => readTokenBalance(requireAddress('asset'), holder, atBlock),
  },
  capTable: () => composeCapTable(),
  ramsStatus: async () =>
    asRamsStatus(await createBrickkenClient().getRamsStatus(mandateQuery(KEEPER_MANDATE))),
});
