import { describe, expect, it } from 'vitest';

import { createAutonomy, type Autonomy } from '../src/demo/autonomy.js';
import {
  EXECUTE_IS_OFF,
  NOTHING_PROPOSED,
  deliverFromPage,
  type DeliverRun,
} from '../src/demo/deliver.js';
import type { SentFromPage } from '../src/demo/execute.js';
import { createSendClock, type SendClock } from '../src/demo/spend.js';
import type { GuardReads } from '../src/keeper/guard.js';
import { PROPOSE_INTENT, type DeliverIntent } from '../src/keeper/intent.js';
import { KeeperError } from '../src/shared/errors.js';
import { requireAddress } from '../src/shared/config.js';
import { registryState } from './support/registry-state.js';

const STATE = registryState();
const SESSION = 'a-visitor';
const OTHER = 'someone-else';
const HASH: `0x${string}` = `0x${'ab'.repeat(32)}`;

const reads: GuardReads = {
  state: () => Promise.resolve(STATE),
  balance: () => Promise.resolve(0n),
};

const INTENT: DeliverIntent = {
  action: 'deliver',
  sendItNow: true,
  amount: 250n * 10n ** 18n,
  pricePerToken: 47n,
  recipient: requireAddress('counterparty'),
  rationale: 'the bid clears the floor and the buyer is cleared',
};

const justSent = (): SendClock => {
  const clock = createSendClock();
  clock.sent(SESSION);
  return clock;
};

const settled = (): SentFromPage => ({
  decision: {
    at: '2026-09-10T12:00:00.000Z',
    decidedBy: 'app',
    verdict: 'proceed',
    refusals: [],
    action: 'deliver',
    amount: String(INTENT.amount),
    pricePerToken: '47',
    recipient: INTENT.recipient,
    rationale: INTENT.rationale,
    holding: null,
    buyerHolds: null,
    state: null,
  },
  delivered: { txId: 'tx-1', transactionHash: HASH },
  returned: null,
});

let reached = 0;

const on = (): Autonomy => {
  const switches = createAutonomy();
  switches.set(SESSION, true);
  return switches;
};

const run = (over: Partial<DeliverRun> = {}): DeliverRun => ({
  session: SESSION,
  clock: createSendClock(),
  intent: INTENT,
  reads,
  autonomy: on(),
  send: () => {
    reached += 1;
    return Promise.resolve(settled());
  },
  ...over,
});

describe('the tool that spends, and the four things that stop it', () => {
  it('takes no amount and no address of its own, so only the guarded intent steers it', () => {
    const run = {
      session: SESSION,
      intent: INTENT,
      reads,
      autonomy: on(),
      clock: createSendClock(),
    };

    expect(Object.keys(run).sort()).toEqual(
      ['autonomy', 'clock', 'intent', 'reads', 'session'].sort(),
    );
  });

  it('refuses when this turn proposed no delivery, and never reaches the chain', async () => {
    reached = 0;

    const answer = await deliverFromPage(run({ intent: null }));

    expect(answer.sent).toBe(false);
    expect(answer.refusedBy).toBe('the proposal');
    expect(answer.because).toBe(NOTHING_PROPOSED);
    expect(reached).toBe(0);
  });

  it('refuses while the switch is off, and never reaches the chain', async () => {
    reached = 0;

    const answer = await deliverFromPage(run({ autonomy: createAutonomy() }));

    expect(answer.sent).toBe(false);
    expect(answer.refusedBy).toBe('the switch');
    expect(answer.because).toBe(EXECUTE_IS_OFF);
    expect(reached).toBe(0);
  });

  it('tells the agent what a person runs instead, rather than only saying no', () => {
    expect(EXECUTE_IS_OFF).toContain('npm run keeper:decide');
    expect(EXECUTE_IS_OFF).toContain('npm run keeper:act');
  });

  it('never offers the switch to the agent, and never names it where the agent is told what to do', () => {
    expect(EXECUTE_IS_OFF).toContain('investor turns it on by hand');
    expect(JSON.stringify(PROPOSE_INTENT).toLowerCase()).not.toContain('switch');
  });

  it('says where the switch is, so a refusal is a way forward and not a dead end', () => {
    expect(EXECUTE_IS_OFF).toContain('Execute button on this page');
    expect(EXECUTE_IS_OFF).toContain('nothing said in this conversation turns it on');
  });

  it('holds one visitor off for a moment after their own send, and reaches nothing', async () => {
    reached = 0;

    const answer = await deliverFromPage(run({ clock: justSent() }));

    expect(answer.sent).toBe(false);
    expect(answer.refusedBy).toBe('the page rate');
    expect(answer.because).toContain('ready again in');
    expect(reached).toBe(0);
  });

  it('never holds a visitor off because a different visitor sent', async () => {
    const switches = createAutonomy();
    switches.set(OTHER, true);

    const answer = await deliverFromPage(
      run({ clock: justSent(), session: OTHER, autonomy: switches }),
    );

    expect(answer.sent).toBe(true);
  });

  it('starts one visitor clock only when the send actually went through', async () => {
    const clock = createSendClock();

    await deliverFromPage(
      run({ clock, send: () => Promise.reject(new KeeperError('brickkenUnreachable', 'no')) }),
    );

    expect(clock.ready(SESSION).allowed).toBe(true);
  });

  it('names the guard when the guard refuses it on the fresh read', async () => {
    const answer = await deliverFromPage(
      run({
        send: () =>
          Promise.reject(
            new KeeperError('actionRefused', 'the guard now refuses it: recipient not allowed'),
          ),
      }),
    );

    expect(answer.sent).toBe(false);
    expect(answer.refusedBy).toBe('the guard');
    expect(answer.because).toContain('recipient not allowed');
  });

  it('names the chain when the send itself fails, and never calls that a refusal', async () => {
    const answer = await deliverFromPage(
      run({ send: () => Promise.reject(new KeeperError('brickkenUnreachable', 'no answer')) }),
    );

    expect(answer.sent).toBe(false);
    expect(answer.refusedBy).toBe('the chain');
    expect(answer.transactionHash).toBeNull();
  });

  it('sends when every gate allows it, and hands back the hash it actually got', async () => {
    const answer = await deliverFromPage(run());

    expect(answer.sent).toBe(true);
    expect(answer.refusedBy).toBeNull();
    expect(answer.transactionHash).toBe(HASH);
    expect(answer.because).toContain(HASH);
    expect(answer.because).toContain('250');
  });

  it('lets an error that is not ours through, rather than reading it as a refusal', async () => {
    await expect(
      deliverFromPage(run({ send: () => Promise.reject(new Error('socket hang up')) })),
    ).rejects.toThrow('socket hang up');
  });
});
