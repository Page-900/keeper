import { decide, type DecideRun, type Sends } from '../keeper/decide.js';
import type { Spoken } from '../keeper/fence.js';
import type { Decision, GuardReads } from '../keeper/guard.js';
import type { DeliverIntent, Intent } from '../keeper/intent.js';
import type { Autonomy } from './autonomy.js';
import { asksToSend } from './asked.js';
import type { Proposals } from './proposals.js';
import type { SendClock } from './spend.js';
import { deliverFromPage, NOTHING_PROPOSED, type Delivered, type DeliverRun } from './deliver.js';
import { gatherMaterial } from '../keeper/material.js';
import type { Asker } from '../keeper/model.js';
import type { Policy } from '../keeper/policy.js';
import { trackProgress, type Stage } from '../shared/progress.js';
import type { DryRunReads } from './dryrun.js';
import { walkLayers, type MandateReads } from './layers.js';
import {
  ATTEMPT_FILE,
  DEMO_GUARD_FILE,
  DEMO_MODEL_FILE,
  recordAttempt,
  spokenAnswer,
  type Attempt,
  type AttemptIntent,
} from './log.js';

const proposed = (intent: Intent): AttemptIntent => ({
  action: intent.action,
  amount: String(intent.amount),
  pricePerToken: String(intent.pricePerToken),
  recipient: intent.recipient,
  rationale: intent.rationale,
});

export interface AttemptFiles {
  attempts?: string;
  decisions?: string;
  model?: string;
}

export interface Executes {
  session: string;
  autonomy: Autonomy;
  clock: SendClock;
  proposals: Proposals;
  send?: DeliverRun['send'];
}

export interface AttemptRun {
  reads: GuardReads;
  execute?: Executes;
  asker?: Asker;
  mandate?: MandateReads;
  dry?: DryRunReads;
  policy?: Policy;
  files?: AttemptFiles;
  onStage?: (stage: Stage) => void;
}

const lastSpoken = (turns: readonly Spoken[]): string => turns.at(-1)?.text ?? '';

const deliverable = (intent: Intent | null): DeliverIntent | null =>
  intent !== null && intent.action === 'deliver' ? intent : null;

const sending =
  (execute: Executes, reads: GuardReads, kept: (done: Delivered) => void): Sends =>
  async (intent) => {
    const done = await deliverFromPage({
      session: execute.session,
      intent: deliverable(intent),
      reads,
      autonomy: execute.autonomy,
      clock: execute.clock,
      ...(execute.send === undefined ? {} : { send: execute.send }),
    });
    kept(done);
    return done.because;
  };

const whyRefused = (decision: Decision): string =>
  decision.refusals.length === 0
    ? 'Nothing was proposed in the turn before this one.'
    : decision.refusals.map((refusal) => refusal.detail).join(' ');

const bothTraces = (deciding: string, speaking: string): string =>
  [deciding, speaking].filter((trace) => trace.trim() !== '').join('\n\n');

/** Only against a proposal already on the screen, so a pasted document is never read as an ask. */
const sendHeld = async (
  execute: Executes,
  reads: GuardReads,
  said: string,
): Promise<Delivered | null> => {
  const { session, proposals, autonomy, clock } = execute;
  if (!asksToSend(said)) return null;
  const intent = proposals.held(session);
  if (intent === null) {
    const why = proposals.refusal(session);
    return why === null ? null : nothingToSend(why);
  }
  const done = await deliverFromPage({
    session,
    intent,
    reads,
    autonomy,
    clock,
    ...(execute.send === undefined ? {} : { send: execute.send }),
  });
  if (done.sent) proposals.drop(session);
  return done;
};

const nothingToSend = (why: string): Delivered => ({
  sent: false,
  refusedBy: 'the proposal',
  because: `${NOTHING_PROPOSED} ${why}`,
  transactionHash: null,
});

const rememberScreen = (execute: Executes, intent: Intent | null, decision: Decision): void => {
  const keeping = decision.verdict === 'proceed' ? deliverable(intent) : null;
  if (keeping !== null) execute.proposals.keep(execute.session, keeping);
  else execute.proposals.refuse(execute.session, whyRefused(decision));
};

/** A stranger's text is material, never an instruction, so it enters where ours does. */
export async function runTurn(turns: readonly Spoken[], run: AttemptRun): Promise<Attempt> {
  const {
    attempts = ATTEMPT_FILE,
    decisions = DEMO_GUARD_FILE,
    model = DEMO_MODEL_FILE,
  } = run.files ?? {};

  const beforehand =
    run.execute === undefined ? null : await sendHeld(run.execute, run.reads, lastSpoken(turns));
  let delivered: Delivered | null = beforehand;
  const progress = trackProgress(run.onStage ?? (() => undefined));
  const decideRun: DecideRun = {
    reads: run.reads,
    material: gatherMaterial(lastSpoken(turns)),
    thread: turns,
    guardFile: decisions,
    modelFile: model,
    progress,
    ...(run.asker === undefined ? {} : { asker: run.asker }),
    ...(run.policy === undefined ? {} : { policy: run.policy }),
    ...(beforehand === null
      ? {}
      : beforehand.sent
        ? { sent: beforehand.because }
        : { refused: beforehand.because }),
    ...(run.execute === undefined || beforehand !== null
      ? {}
      : {
          sends: sending(run.execute, run.reads, (done) => {
            delivered = done;
          }),
        }),
  };

  const { reply, spoke, intent, decision } = await decide(decideRun);
  if (run.execute !== undefined && decision !== null) rememberScreen(run.execute, intent, decision);
  const layers =
    intent === null || decision === null
      ? null
      : await walkLayers(intent, decision, {
          ...(run.mandate === undefined ? {} : { reads: run.mandate }),
          ...(run.dry === undefined ? {} : { dry: run.dry }),
        });
  progress.reached('layers');

  const proposal = intent === null ? null : proposed(intent);
  const attempt = recordAttempt(attempts, {
    said: lastSpoken(turns),
    answer: spokenAnswer((spoke ?? reply).text, proposal),
    reasoning: bothTraces(reply.reasoning, spoke?.reasoning ?? ''),
    intent: proposal,
    verdict: decision?.verdict ?? null,
    refusals: decision?.refusals ?? [],
    layers,
    delivered,
  });
  progress.reached('recorded');
  return attempt;
}
