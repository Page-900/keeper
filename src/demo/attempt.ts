import { decide, type DecideRun } from '../keeper/decide.js';
import type { Spoken } from '../keeper/fence.js';
import type { GuardReads } from '../keeper/guard.js';
import type { Intent } from '../keeper/intent.js';
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

export interface AttemptRun {
  reads: GuardReads;
  asker?: Asker;
  mandate?: MandateReads;
  dry?: DryRunReads;
  policy?: Policy;
  files?: AttemptFiles;
  onStage?: (stage: Stage) => void;
}

const lastSpoken = (turns: readonly Spoken[]): string => turns.at(-1)?.text ?? '';

/** A stranger's text is material, never an instruction, so it enters where ours does. */
export async function runTurn(turns: readonly Spoken[], run: AttemptRun): Promise<Attempt> {
  const {
    attempts = ATTEMPT_FILE,
    decisions = DEMO_GUARD_FILE,
    model = DEMO_MODEL_FILE,
  } = run.files ?? {};

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
  };

  const { reply, intent, decision } = await decide(decideRun);
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
    answer: spokenAnswer(reply.text, proposal),
    reasoning: reply.reasoning,
    intent: proposal,
    verdict: decision?.verdict ?? null,
    refusals: decision?.refusals ?? [],
    layers,
  });
  progress.reached('recorded');
  return attempt;
}
