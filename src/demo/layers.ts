import type { Layer } from '../chain/battery.js';
import { agreeWithChain, evaluate } from '../chain/differential.js';
import { sunlAmount } from '../chain/mandate.js';
import { readCanExecute, type RegistryRead } from '../chain/registry.js';
import type { Decision } from '../keeper/guard.js';
import type { DeliverIntent, Intent } from '../keeper/intent.js';
import { TRANSFER_ACTION, requireAddress } from '../shared/config.js';
import { dryRun, type DryRun, type DryRunReads } from './dryrun.js';

export type LayerVerdict = 'allows' | 'refuses' | 'not asked';

export interface LayerAnswer {
  layer: Layer;
  verdict: LayerVerdict;
  because: string[];
}

export interface LayerWalk {
  answers: LayerAnswer[];
  blockNumber: string | null;
  onlyOurCode: boolean;
  note: string | null;
  dryRun: DryRun | null;
}

/** The sentence this project exists to be able to say. The token row beside it carries the run. */
export const NOTHING_ON_CHAIN =
  'Nothing on the chain would have stopped this if the app had let it through. ' +
  'The permission does not look at who receives, and the token checks only who sends.';

const TOKEN_CHECKS =
  'The token asks whether the sender is cleared to hold it. ' +
  'It does not look at who receives, so it never refuses on the recipient.';

const NOTHING_WAS_SENT = 'Nothing was sent, so the token was never asked.';

const APP_VERDICT: Readonly<Record<Decision['verdict'], LayerVerdict>> = Object.freeze({
  proceed: 'allows',
  refused: 'refuses',
  declined: 'not asked',
});

export const NOTHING_TO_REFUSE =
  'The investor policy and the bounds of the permission were both checked, and neither was broken.';

const NOTHING_PROPOSED = 'The agent proposed nothing, so there was nothing to check.';

const appBecause = (decision: Decision): string[] => {
  if (decision.verdict === 'declined') return [NOTHING_PROPOSED];
  if (decision.refusals.length === 0) return [NOTHING_TO_REFUSE];
  return decision.refusals.map(
    (refusal) => `${refusal.rule}, ${refusal.detail}, refused by the ${refusal.source}.`,
  );
};

const appAnswer = (decision: Decision): LayerAnswer => ({
  layer: 'app',
  verdict: APP_VERDICT[decision.verdict],
  because: appBecause(decision),
});

export interface MandateReads {
  canExecute: (amount: bigint, atBlock: bigint) => Promise<boolean>;
}

const CHAIN: MandateReads = {
  canExecute: (amount, atBlock) =>
    readCanExecute({
      agent: requireAddress('agent'),
      principal: requireAddress('principal'),
      asset: requireAddress('asset'),
      action: TRANSFER_ACTION,
      amount,
      atBlock,
    }),
};

const NOT_ASKED: LayerAnswer = Object.freeze({
  layer: 'mandate',
  verdict: 'not asked',
  because: ['The agent proposed nothing, so no amount was put to the registry.'],
});

/** The registry answers one boolean. The clause it fails first is our reading, and it says so. */
async function mandateAnswer(
  state: RegistryRead,
  amount: bigint,
  reads: MandateReads,
): Promise<LayerAnswer> {
  const atBlock = BigInt(state.blockNumber);
  const evaluation = agreeWithChain(
    evaluate(state, amount),
    await reads.canExecute(amount, atBlock),
  );
  const asked = `${sunlAmount(amount)} at block ${state.blockNumber}`;
  return {
    layer: 'mandate',
    verdict: evaluation.allowed ? 'allows' : 'refuses',
    because: evaluation.allowed
      ? [`The registry was asked about ${asked} and answered yes. Our own reading of it agrees.`]
      : [
          `The registry was asked about ${asked} and answered no. Our own reading of it agrees.`,
          `The first limit it breaks is the ${evaluation.firstFalse ?? 'none'}.`,
        ],
  };
}

const REFUSED_FIRST: Readonly<Record<Layer, string>> = Object.freeze({
  app: "This app's executor refused first",
  mandate: 'The permission refused first',
  token: 'The token answered',
});

const chainAsked = (run: DryRun): string =>
  `The chain was asked at block ${run.atBlock} whether this exact delivery would go through, and nothing was sent.`;

const tokenAnswer = (run: DryRun | null): LayerAnswer => {
  if (run === null)
    return { layer: 'token', verdict: 'not asked', because: [NOTHING_WAS_SENT, TOKEN_CHECKS] };
  if (run.layer !== 'token')
    return {
      layer: 'token',
      verdict: 'not asked',
      because: [chainAsked(run), `${REFUSED_FIRST[run.layer]}, so the token was never reached.`],
    };
  return {
    layer: 'token',
    verdict: run.allowed ? 'allows' : 'refuses',
    because: [
      chainAsked(run),
      run.allowed ? TOKEN_CHECKS : 'The token refused the transfer itself.',
    ],
  };
};

export interface WalkRun {
  reads?: MandateReads;
  dry?: DryRunReads;
}

const deliveryIn = (intent: Intent): DeliverIntent | null =>
  intent.action === 'deliver' ? intent : null;

/** One live read of the registry per attempt, at the block the guard already read its state at. */
export async function walkLayers(
  intent: Intent,
  decision: Decision,
  { reads = CHAIN, dry }: WalkRun = {},
): Promise<LayerWalk> {
  const app = appAnswer(decision);
  const mandate =
    decision.state === null ? NOT_ASKED : await mandateAnswer(decision.state, intent.amount, reads);
  const delivery = deliveryIn(intent);
  const run =
    decision.state === null || delivery === null
      ? null
      : await dryRun(delivery, BigInt(decision.state.blockNumber), dry);
  const onlyOurCode = app.verdict === 'refuses' && mandate.verdict === 'allows';
  return {
    answers: [app, mandate, tokenAnswer(run)],
    blockNumber: decision.state?.blockNumber ?? null,
    onlyOurCode,
    note: onlyOurCode ? NOTHING_ON_CHAIN : null,
    dryRun: run,
  };
}
