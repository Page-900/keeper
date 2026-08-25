import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  prepareAgentAction,
  sendAgentAction,
  type ExecuteSurface,
} from '../src/brickken/execute.js';
import { agentCalldata, firstAction } from '../src/chain/action.js';
import type { Anchor } from '../src/chain/anchors.js';
import { MAX_TRANSACTION_VALUE, requireAddress } from '../src/shared/config.js';
import { readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';

const HASH = `0x${'ef'.repeat(32)}` as const;

const action = firstAction();

interface Seen {
  execute: number;
  sends: number;
  inputs: Record<string, unknown>[];
}

const surfaceWith = (
  overrides: { data?: `0x${string}`; sent?: boolean } = {},
): { surface: ExecuteSurface; seen: Seen } => {
  const seen: Seen = { execute: 0, sends: 0, inputs: [] };
  const surface: ExecuteSurface = {
    execute: (input, options) => {
      seen.execute += 1;
      seen.inputs.push(input);
      if (options.execute === true) seen.sends += 1;
      const data =
        overrides.data ?? `0xdeadbeef${agentCalldata(action.to, action.amount).slice(2)}`;
      const sent = overrides.sent === false ? undefined : { ok: true };
      return Promise.resolve({
        txId: 'prepared-action',
        transactions: [{ data }],
        executionMode: 'client-signed',
        ...(options.execute === true ? { sent } : {}),
      } as never);
    },
    settled: () => Promise.resolve({ status: 'success' as const, transactionHash: HASH }),
  };
  return { surface, seen };
};

let anchors: string;
let file: string;
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-action-'));
  anchors = join(directory, 'chain-anchors.jsonl');
  file = join(directory, 'brickken-requests.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const receipt = () =>
  Promise.resolve({
    status: 'success' as const,
    blockNumber: 11_558_400n,
    contractAddress: null,
    gasUsed: 288_091n,
  });

describe('what Brickken would send is read before it is sent', () => {
  it('recognises the transfer this project asked for inside the prepared call', async () => {
    const { surface } = surfaceWith();

    expect((await prepareAgentAction(action, surface, file)).carriesOurCall).toBe(true);
  });

  it('refuses to send a prepared call that is not the transfer we asked for', async () => {
    const { surface, seen } = surfaceWith({ data: '0xdeadbeef' });

    const error = await captureError(() =>
      sendAgentAction({ action, surface, anchors, file, receipt }),
    );

    expect(error.kind).toBe('payloadMismatch');
    expect(seen.sends).toBe(0);
  });

  it('asks for the transfer to leave the investor, never the agent', async () => {
    const { surface, seen } = surfaceWith();

    await prepareAgentAction(action, surface, file);

    expect(seen.inputs[0]?.['from']).toBe(requireAddress('principal'));
    expect(seen.inputs[0]?.['to']).toBe(requireAddress('counterparty'));
    expect(seen.inputs[0]?.['amount']).toBe(String(MAX_TRANSACTION_VALUE));
  });
});

describe('the action is sent once and its hash is read from the chain', () => {
  it('prepares, checks, then sends, and records the mined hash', async () => {
    const { surface, seen } = surfaceWith();

    const settlement = await sendAgentAction({ action, surface, anchors, file, receipt });

    expect(settlement.transactionHash).toBe(HASH);
    expect(seen.sends).toBe(1);
    expect(readRecords<Anchor>(anchors)[0]?.blockNumber).toBe('11558400');
  });

  it('refuses a second run, because the running total never goes back down', async () => {
    const { surface } = surfaceWith();
    await sendAgentAction({ action, surface, anchors, file, receipt });

    const error = await captureError(() =>
      sendAgentAction({ action, surface, anchors, file, receipt }),
    );

    expect(error.kind).toBe('alreadyCreated');
  });

  it('records a reverted action rather than discarding it', async () => {
    const { surface } = surfaceWith();
    const reverted = () =>
      Promise.resolve({
        status: 'reverted' as const,
        blockNumber: 11_558_401n,
        contractAddress: null,
        gasUsed: 54_000n,
      });

    const error = await captureError(() =>
      sendAgentAction({ action, surface, anchors, file, receipt: reverted }),
    );

    expect(error.kind).toBe('writeUnconfirmed');
    expect(readRecords<Anchor>(anchors)).toHaveLength(1);
  });

  it('refuses a send that never reported being sent', async () => {
    const { surface } = surfaceWith({ sent: false });

    const error = await captureError(() =>
      sendAgentAction({ action, surface, anchors, file, receipt }),
    );

    expect(error.kind).toBe('writeUnconfirmed');
  });
});
