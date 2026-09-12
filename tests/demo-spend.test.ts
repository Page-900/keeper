import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Anchor, AnchorAction } from '../src/chain/anchors.js';
import {
  SECONDS_BETWEEN_SENDS,
  createSendClock,
  nextAction,
  nextReturn,
} from '../src/demo/spend.js';
import { appendRecord } from '../src/shared/jsonl.js';

const NOON = Date.parse('2026-09-11T12:00:00.000Z');
const ONE = 'a-visitor';
const OTHER = 'someone-else';

let clock = NOON;
let directory: string;
let file: string;

const sending = () => createSendClock({ now: () => clock });

beforeEach(() => {
  clock = NOON;
  directory = mkdtempSync(join(tmpdir(), 'keeper-spend-'));
  file = join(directory, 'chain-anchors.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const sent = (action: AnchorAction, at: string, status: Anchor['status'] = 'success'): void => {
  appendRecord(file, {
    at,
    action,
    chainId: 11155111,
    transactionHash: `0x${'ab'.padStart(64, '0')}`,
    blockNumber: '1',
    status,
    contract: null,
    gasUsed: '1',
    venue: 'registry',
  } satisfies Anchor);
};

describe('anyone may send, and no one may run it in a loop', () => {
  it('lets a visitor who has sent nothing send now', () => {
    expect(sending().ready(ONE).allowed).toBe(true);
  });

  it('holds that visitor off for a moment once they have sent', () => {
    const sends = sending();
    sends.sent(ONE);

    const answer = sends.ready(ONE);

    expect(answer.allowed).toBe(false);
    expect(answer.waitSeconds).toBe(SECONDS_BETWEEN_SENDS);
    expect(answer.because).toContain('ready again in');
  });

  it('lets the same visitor send again once the moment has passed', () => {
    const sends = sending();
    sends.sent(ONE);
    clock = NOON + SECONDS_BETWEEN_SENDS * 1000;

    expect(sends.ready(ONE).allowed).toBe(true);
  });

  it('never holds one visitor off because another one sent', () => {
    const sends = sending();
    sends.sent(ONE);

    expect(sends.ready(OTHER).allowed).toBe(true);
  });

  it('has no total and no daily ceiling, so a hundred visitors all get a turn', () => {
    const sends = sending();
    for (let at = 0; at < 100; at += 1) {
      const visitor = `visitor-${String(at)}`;
      expect(sends.ready(visitor).allowed).toBe(true);
      sends.sent(visitor);
    }
  });

  it('lets one visitor send all day, a minute apart, for as long as they like', () => {
    const sends = sending();
    for (let at = 0; at < 50; at += 1) {
      clock = NOON + at * SECONDS_BETWEEN_SENDS * 1000;
      expect(sends.ready(ONE).allowed).toBe(true);
      sends.sent(ONE);
    }
  });

  it('names the next pair of records so no send can quietly overwrite another', () => {
    sent('page-action-1', '2026-09-10T09:00:00.000Z');

    expect(nextAction(file)).toBe('page-action-2');
    expect(nextReturn(file)).toBe('page-return-2');
  });

  it('never counts what the operator sent from a terminal as a page send', () => {
    sent('keeper-action', '2026-09-11T08:00:00.000Z');

    expect(nextAction(file)).toBe('page-action-1');
  });
});
