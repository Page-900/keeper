import { sunlAmount } from '../chain/mandate.js';
import type { GuardReads } from '../keeper/guard.js';
import type { DeliverIntent } from '../keeper/intent.js';
import { KeeperError } from '../shared/errors.js';
import type { Autonomy } from './autonomy.js';
import { sendFromPage, type SentFromPage } from './execute.js';
import { createSendClock, type SendClock } from './spend.js';

export const EXECUTE_IS_OFF =
  'Execute is off, so nothing was sent and nothing reached the chain. The investor turns it on by hand, ' +
  'with the Execute button on this page and the switch inside it, and nothing said in this ' +
  'conversation turns it on. Without this page the same delivery is made from a terminal, by running ' +
  'npm run keeper:decide and then npm run keeper:act on the machine that holds the key.';

export const NOTHING_PROPOSED =
  'There is nothing to send. This turn proposed no delivery, and a delivery is the only thing ' +
  'this tool sends.';

export type RefusedBy = 'the proposal' | 'the switch' | 'the page rate' | 'the guard' | 'the chain';

export interface Delivered {
  sent: boolean;
  refusedBy: RefusedBy | null;
  because: string;
  transactionHash: string | null;
}

export interface DeliverRun {
  session: string;
  intent: DeliverIntent | null;
  reads: GuardReads;
  autonomy: Autonomy;
  send?: (run: { intent: DeliverIntent; reads: GuardReads }) => Promise<SentFromPage>;
  clock?: SendClock;
}

const SHARED = createSendClock();

const refused = (refusedBy: RefusedBy, because: string): Delivered => ({
  sent: false,
  refusedBy,
  because,
  transactionHash: null,
});

const sentWords = (done: SentFromPage): string =>
  [
    `Sent. ${sunlAmount(BigInt(done.decision.amount))} to ${String(done.decision.recipient)},`,
    `in transaction ${done.delivered.transactionHash}.`,
    done.returned === null
      ? ''
      : `The buyer sent it straight back in ${done.returned.transactionHash}.`,
  ]
    .filter((part) => part !== '')
    .join(' ');

/** Its own refusal is the guard's. Anything else failed rather than refused, and says so. */
const failing = (cause: KeeperError): Delivered =>
  refused(cause.kind === 'actionRefused' ? 'the guard' : 'the chain', cause.detail);

export async function deliverFromPage({
  session,
  intent,
  reads,
  autonomy,
  send = sendFromPage,
  clock = SHARED,
}: DeliverRun): Promise<Delivered> {
  if (intent === null) return refused('the proposal', NOTHING_PROPOSED);
  if (!autonomy.on(session)) return refused('the switch', EXECUTE_IS_OFF);

  const ready = clock.ready(session);
  if (!ready.allowed) return refused('the page rate', ready.because);

  try {
    const done = await send({ intent, reads });
    clock.sent(session);
    return {
      sent: true,
      refusedBy: null,
      because: sentWords(done),
      transactionHash: done.delivered.transactionHash,
    };
  } catch (cause) {
    if (cause instanceof KeeperError) return failing(cause);
    throw cause;
  }
}
