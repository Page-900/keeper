import { describe, expect, it } from 'vitest';

import type { RevertReason } from '../src/chain/client.js';
import { dryRun, type DryRunReads } from '../src/demo/dryrun.js';
import type { DeliverIntent } from '../src/keeper/intent.js';
import { MAX_TRANSACTION_VALUE } from '../src/shared/config.js';

const ATTACKER = `0x${'ab'.repeat(20)}` as const;
const AT_BLOCK = 11_612_601n;

const INTENT: DeliverIntent = {
  action: 'deliver',
  amount: MAX_TRANSACTION_VALUE,
  pricePerToken: 50n,
  recipient: ATTACKER,
  rationale: 'the bid clears the floor',
};

const serving = (revert: RevertReason | null): DryRunReads => ({
  refusal: () => Promise.resolve(revert),
});

const failing = (): DryRunReads => ({
  refusal: () => Promise.reject(new Error('the endpoint did not answer')),
});

const reverting = (error: string, args: string[] = []): DryRunReads => serving({ error, args });

describe('the dry run says which layer would have answered, and never guesses', () => {
  it('reads no revert as the whole path allowing it, which is the recipient finding', async () => {
    const run = await dryRun(INTENT, AT_BLOCK, serving(null));

    expect(run).toEqual({ layer: 'token', allowed: true, revert: null, atBlock: '11612601' });
  });

  it('gives CannotExecute to the mandate, because the token is never reached', async () => {
    const run = await dryRun(
      INTENT,
      AT_BLOCK,
      reverting('CannotExecute', ['0x1', '0x2', '3', '4']),
    );

    expect(run?.layer).toBe('mandate');
    expect(run?.allowed).toBe(false);
  });

  it('gives CallFailed to the token, because only the token call can produce it', async () => {
    const run = await dryRun(INTENT, AT_BLOCK, reverting('CallFailed', ['0x']));

    expect(run?.layer).toBe('token');
    expect(run?.allowed).toBe(false);
  });

  it('gives UnsupportedAction to this app, never to the mandate', async () => {
    const run = await dryRun(INTENT, AT_BLOCK, reverting('UnsupportedAction', ['0x23b872dd']));

    expect(run?.layer).toBe('app');
  });

  it('gives InvalidData to this app as well', async () => {
    expect((await dryRun(INTENT, AT_BLOCK, reverting('InvalidData')))?.layer).toBe('app');
  });

  it('claims nothing at all when the revert is one it cannot attribute', async () => {
    const run = await dryRun(INTENT, AT_BLOCK, reverting('AccessControlUnauthorizedAccount'));

    expect(run).toBeNull();
  });

  it('claims nothing when the read itself failed, rather than reading silence as a yes', async () => {
    expect(await dryRun(INTENT, AT_BLOCK, failing())).toBeNull();
  });

  it('carries the block it was asked at, so the answer is not undated', async () => {
    const run = await dryRun(INTENT, 11_600_000n, serving(null));

    expect(run?.atBlock).toBe('11600000');
  });

  it('asks about the recipient the agent proposed and the amount it proposed', async () => {
    const asked: unknown[] = [];
    const reads: DryRunReads = {
      refusal: (action, atBlock) => {
        asked.push({ action, atBlock });
        return Promise.resolve(null);
      },
    };

    await dryRun(INTENT, AT_BLOCK, reads);

    expect(asked).toEqual([
      { action: { to: ATTACKER, amount: MAX_TRANSACTION_VALUE }, atBlock: AT_BLOCK },
    ]);
  });
});
