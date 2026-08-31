import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { keccak256 } from 'viem';

import type { RevertReason } from '../src/chain/client.js';
import type { RegistryRead } from '../src/chain/registry.js';
import {
  REFUSALS,
  REVOKE_CASE,
  alreadyRun,
  runExpiredDeadline,
  runReplay,
  runDuplicateGrant,
  runRevoke,
  revokeCall,
  usedRevoke,
  type SignatureChain,
  type SignatureRecord,
} from '../src/chain/signatures.js';
import { readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';
import { registryState } from './support/registry-state.js';
import { requireAddress } from '../src/shared/config.js';

const SIGNATURE: `0x${string}` = `0x${'ab'.repeat(65)}`;

const DEADLINE = 9_999_999_999n;

const HASH: `0x${string}` = `0x${'ef'.repeat(32)}`;

const EXPIRED: RevertReason = { error: REFUSALS.D1, args: [] };

const INVALID: RevertReason = { error: REFUSALS.R1, args: [] };

interface Seen {
  sent: `0x${string}`[];
}

const fakeChain = (
  revert: RevertReason | null,
  over: Partial<SignatureChain> = {},
  state: RegistryRead = registryState(),
): { chain: SignatureChain; seen: Seen } => {
  const seen: Seen = { sent: [] };
  const chain: SignatureChain = {
    state: () => Promise.resolve(state),
    sign: () => Promise.resolve(SIGNATURE),
    simulate: () => Promise.resolve(revert),
    signGrant: () => Promise.resolve(SIGNATURE),
    spent: () =>
      Promise.resolve(
        revokeCall(
          {
            agent: requireAddress('probe'),
            principal: requireAddress('principal'),
            nonce: 0n,
            deadline: DEADLINE,
          },
          SIGNATURE,
        ),
      ),
    send: (call) => {
      seen.sent.push(call.signature);
      return Promise.resolve(HASH);
    },
    confirm: () =>
      Promise.resolve({
        status: revert === null ? 'success' : 'reverted',
        blockNumber: '11594100',
      }),
    ...over,
  };
  return { chain, seen };
};

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-signatures-'));
  file = join(directory, 'signatures.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const spendARevoke = async (): Promise<SignatureRecord> => {
  const { chain } = fakeChain(null);
  return runRevoke({ chain, agent: 'probe', file });
};

describe('a revoke is spent once, and the bytes it spent are kept', () => {
  it('records the signature the chain accepted, so a replay uses the real one', async () => {
    const record = await spendARevoke();

    expect(record.refused).toBe(false);
    expect(record.signatureDigest).toBe(keccak256(SIGNATURE));
    expect(readRecords<SignatureRecord>(file)).toHaveLength(1);
  });

  it('has nothing to replay until a revoke has been spent', () => {
    expect(() => usedRevoke(file)).toThrow();
  });

  it('refuses to spend the same case twice, so a rerun cannot invent a second anchor', async () => {
    await spendARevoke();
    const { chain } = fakeChain(null);

    const error = await captureError(() => runRevoke({ chain, agent: 'probe', file }));

    expect(error.kind).toBe('alreadyCreated');
    expect(alreadyRun(REVOKE_CASE, file)).toBe(true);
  });
});

describe('the deadline is checked before the digest, so the two cases stay apart', () => {
  it('refuses the payload the block has already passed', async () => {
    const { chain } = fakeChain(EXPIRED);

    const record = await runExpiredDeadline({ chain, agent: 'probe', file });

    expect(record.revert?.error).toBe('SignatureExpired');
    expect(BigInt(record.deadline)).toBeLessThan(BigInt(record.clockBefore));
  });

  it('sends nothing when the deadline it calls expired is still in the future', async () => {
    const clocks = [registryState(), registryState({ blockTimestamp: '1' })];
    const { chain, seen } = fakeChain(EXPIRED, {
      state: () => Promise.resolve(clocks.shift() ?? registryState({ blockTimestamp: '1' })),
    });

    const error = await captureError(() => runExpiredDeadline({ chain, agent: 'probe', file }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(seen.sent).toEqual([]);
  });

  it('sends nothing when a case reverts with the other signature error', async () => {
    const { chain, seen } = fakeChain(INVALID);

    const error = await captureError(() => runExpiredDeadline({ chain, agent: 'probe', file }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(seen.sent).toEqual([]);
  });
});

describe('a replay is only a replay once the number it was signed against has moved', () => {
  it('resubmits the spent bytes and is refused on the signature', async () => {
    const spent = await spendARevoke();
    const moved = registryState({ principalNonce: String(Number(spent.nonceSigned) + 1) });
    const { chain, seen } = fakeChain(INVALID, {}, moved);

    const record = await runReplay({ chain, agent: 'probe', file });

    expect(record.revert?.error).toBe('InvalidSignature');
    expect(seen.sent).toEqual([SIGNATURE]);
    expect(spent.signatureDigest).toBe(keccak256(SIGNATURE));
  });

  it('sends nothing while the replay number is the one the signature was made against', async () => {
    await spendARevoke();
    const { chain, seen } = fakeChain(INVALID);

    const error = await captureError(() => runReplay({ chain, agent: 'probe', file }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(seen.sent).toEqual([]);
  });

  it('sends nothing once the spent signature is past its own deadline', async () => {
    const spent = await spendARevoke();
    const late = registryState({
      principalNonce: String(Number(spent.nonceSigned) + 1),
      blockTimestamp: String(BigInt(spent.deadline) + 1n),
    });
    const { chain, seen } = fakeChain(INVALID, {}, late);

    const error = await captureError(() => runReplay({ chain, agent: 'probe', file }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(seen.sent).toEqual([]);
  });

  it('refuses a refusal the chain reports as a success', async () => {
    const spent = await spendARevoke();
    const moved = registryState({ principalNonce: String(Number(spent.nonceSigned) + 1) });
    const { chain } = fakeChain(
      INVALID,
      { confirm: () => Promise.resolve({ status: 'success', blockNumber: '11594100' }) },
      moved,
    );

    const error = await captureError(() => runReplay({ chain, agent: 'probe', file }));

    expect(error.kind).toBe('writeUnconfirmed');
  });
});

describe('a second grant on a live mandate is refused before the signature is looked at', () => {
  const ACTIVE: RevertReason = { error: REFUSALS.X4, args: [] };

  it('records the refusal while the mandate it would duplicate is still live', async () => {
    const { chain } = fakeChain(ACTIVE);

    const record = await runDuplicateGrant({ chain, agent: 'probe', file });

    expect(record.case).toBe('X4');
    expect(record.revert?.error).toBe('MandateAlreadyActive');
  });

  it('sends nothing once that mandate has been revoked, because a second grant would be taken', async () => {
    const { chain, seen } = fakeChain(ACTIVE, {}, registryState({ mandateRevoked: true }));

    const error = await captureError(() => runDuplicateGrant({ chain, agent: 'probe', file }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(seen.sent).toEqual([]);
  });

  it('sends nothing once that mandate has expired, for the same reason', async () => {
    const expired = registryState({ mandateValidUntil: '1', blockTimestamp: '2' });
    const { chain, seen } = fakeChain(ACTIVE, {}, expired);

    const error = await captureError(() => runDuplicateGrant({ chain, agent: 'probe', file }));

    expect(error.kind).toBe('refusalUnattributable');
    expect(seen.sent).toEqual([]);
  });
});
