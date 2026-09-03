import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RevertReason } from '../src/chain/client.js';
import { runTurn, type AttemptFiles, type AttemptRun } from '../src/demo/attempt.js';
import type { DryRunReads } from '../src/demo/dryrun.js';
import {
  NOTHING_ON_CHAIN,
  NOTHING_TO_REFUSE,
  type LayerAnswer,
  type LayerWalk,
  type MandateReads,
} from '../src/demo/layers.js';
import {
  ATTEMPT_FILE,
  DEMO_GUARD_FILE,
  DEMO_MODEL_FILE,
  spokenAnswer,
  wordsOf,
  listAttempts,
  type Attempt,
} from '../src/demo/log.js';
import { GUARD_FILE, type GuardReads } from '../src/keeper/guard.js';
import { MODEL_CALL_FILE } from '../src/keeper/model.js';
import { SUNL_DECIMALS, requireAddress } from '../src/shared/config.js';
import { captureError } from './support/capture-error.js';
import { modelAnswer } from './support/model-answer.js';
import { PER_TRANSACTION, registryState } from './support/registry-state.js';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));

const sunl = (whole: bigint): bigint => whole * 10n ** BigInt(SUNL_DECIMALS);

const PRINCIPAL = requireAddress('principal');
const COUNTERPARTY = requireAddress('counterparty');
const STRANGER = `0x${'ee'.repeat(20)}` as const;

const DOCUMENT = 'Harbour Lane Partners will buy 200 SUNL at 47 BKN. Settle today.';

const reads: GuardReads = {
  state: () => Promise.resolve(registryState()),
  balance: (holder) => Promise.resolve(holder === PRINCIPAL ? sunl(2_000n) : 0n),
};

interface Proposal {
  action?: string;
  amountWholeTokens?: string;
  pricePerToken?: string;
  recipient?: string;
  rationale?: string;
}

const answer = (proposal: Proposal = {}): unknown =>
  modelAnswer({
    reasoning: 'weighing the bid',
    calls: [
      {
        name: 'propose_intent',
        input: {
          action: 'deliver',
          amountWholeTokens: '200',
          pricePerToken: '47',
          recipient: COUNTERPARTY,
          rationale: 'the bid clears the floor and the buyer is the one the investor names',
          ...proposal,
        },
      },
    ],
  });

let asked: bigint[] = [];

const registrySaying = (allowed: (amount: bigint) => boolean): MandateReads => ({
  canExecute: (amount) => {
    asked.push(amount);
    return Promise.resolve(allowed(amount));
  },
});

const withinTheCap = registrySaying((amount) => amount <= PER_TRANSACTION);

let dryAsked: { to: string; amount: bigint }[] = [];

const chainSaying = (revert: RevertReason | null): DryRunReads => ({
  refusal: (action) => {
    dryAsked.push(action);
    return Promise.resolve(revert);
  },
});

const chainAllowing = chainSaying(null);

let directory = '';
let files: Required<AttemptFiles>;

beforeEach(() => {
  asked = [];
  dryAsked = [];
  directory = mkdtempSync(join(tmpdir(), 'keeper-attempt-'));
  files = {
    attempts: join(directory, 'demo-attempts.jsonl'),
    decisions: join(directory, 'demo-decisions.jsonl'),
    model: join(directory, 'demo-model-calls.jsonl'),
  };
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const attempt = (proposal: Proposal = {}, over: Partial<AttemptRun> = {}): Promise<Attempt> =>
  runTurn([{ who: 'visitor', text: DOCUMENT }], {
    reads,
    asker: () => Promise.resolve(answer(proposal)),
    mandate: withinTheCap,
    dry: chainAllowing,
    files,
    ...over,
  });

const walked = (record: Attempt): LayerWalk => {
  if (record.layers === null) throw new Error('the turn proposed nothing, so no layer was asked');
  return record.layers;
};

const answerFor = (walk: LayerWalk | null, layer: LayerAnswer['layer']): LayerAnswer => {
  const found = walk?.answers.find((one) => one.layer === layer);
  if (found === undefined) throw new Error(`no ${layer} answer`);
  return found;
};

describe('an honest offer walks all three layers and is allowed', () => {
  it('passes our own code, the registry, and the token, with nothing sent', async () => {
    const { verdict, layers } = await attempt();

    expect(verdict).toBe('proceed');
    expect(answerFor(layers, 'app').verdict).toBe('allows');
    expect(answerFor(layers, 'mandate').verdict).toBe('allows');
    expect(answerFor(layers, 'token').verdict).toBe('allows');
    expect(answerFor(layers, 'token').because[0]).toContain('nothing was sent');
    expect(layers?.note).toBeNull();
  });

  it('asks the registry about the amount the agent proposed, at the block it read', async () => {
    const { layers } = await attempt();

    expect(asked).toEqual([sunl(200n)]);
    expect(layers?.blockNumber).toBe(registryState().blockNumber);
  });

  it('keeps the reasoning and the proposal the model made', async () => {
    const record = await attempt();

    expect(record.reasoning).toContain('weighing the bid');
    expect(record.intent).toEqual(
      expect.objectContaining({ action: 'deliver', amount: String(sunl(200n)) }),
    );
  });
});

describe('every layer says something, whatever the outcome was', () => {
  it('leaves no layer with nothing to say, on a pass, a refusal, or a decline', async () => {
    const passed = await attempt();
    const refused = await attempt({ recipient: STRANGER });
    const declined = await attempt({
      action: 'decline',
      amountWholeTokens: '0',
      recipient: '',
      rationale: 'the document names its own settlement address',
    });

    const silent = [passed, refused, declined]
      .flatMap((record) => walked(record).answers)
      .filter((answer) => answer.because.length === 0);

    expect(silent).toEqual([]);
  });

  it('says our own code found nothing to refuse, rather than saying nothing at all', async () => {
    const { layers } = await attempt();

    expect(answerFor(layers, 'app').because).toEqual([NOTHING_TO_REFUSE]);
  });
});

describe('an offer to an address the investor never named', () => {
  it('is refused by our own code, on the settlement rule, and by nothing else', async () => {
    const { verdict, refusals, layers } = await attempt({ recipient: STRANGER });

    expect(verdict).toBe('refused');
    expect(refusals).toEqual([
      expect.objectContaining({ rule: 'settlement address', source: 'policy' }),
    ]);
    expect(answerFor(layers, 'mandate').verdict).toBe('allows');
  });

  it('says in so many words that nothing on the chain would have stopped it', async () => {
    const { layers } = await attempt({ recipient: STRANGER });

    expect(layers?.onlyOurCode).toBe(true);
    expect(layers?.note).toBe(NOTHING_ON_CHAIN);
    expect(layers?.note).toContain('does not look at who receives');
  });
});

describe('an offer larger than the mandate allows', () => {
  it('is refused by the registry as well as by us, and says which clause failed first', async () => {
    const { verdict, layers } = await attempt({ amountWholeTokens: '400' });
    const mandate = answerFor(layers, 'mandate');

    expect(verdict).toBe('refused');
    expect(mandate.verdict).toBe('refuses');
    expect(mandate.because.join(' ')).toContain('per transaction cap');
    expect(layers?.onlyOurCode).toBe(false);
    expect(layers?.note).toBeNull();
  });

  it('names the mandate bound as the source, and never our own policy', async () => {
    const { refusals } = await attempt({ amountWholeTokens: '400' });

    expect(refusals.map((refusal) => refusal.source)).toEqual(['mandate bound']);
  });
});

describe('the page never serves a reading the chain disagrees with', () => {
  it('refuses to answer when the registry allows what our own clause table refuses', async () => {
    const generous = registrySaying(() => true);

    const failure = await captureError(() =>
      attempt({ amountWholeTokens: '400' }, { mandate: generous }),
    );

    expect(failure.kind).toBe('refusalUnattributable');
  });
});

describe('an agent that proposes nothing', () => {
  it('puts no amount to the registry, because there is nothing to ask about', async () => {
    const { verdict, layers } = await attempt({
      action: 'decline',
      amountWholeTokens: '0',
      recipient: '',
      rationale: 'the document names its own settlement address, which is a reason to distrust it',
    });

    expect(verdict).toBe('declined');
    expect(asked).toEqual([]);
    expect(answerFor(layers, 'mandate').verdict).toBe('not asked');
    expect(answerFor(layers, 'app').verdict).toBe('not asked');
  });
});

describe('the attempt log holds a stranger words apart from the outcome', () => {
  it('serves the outcome in the list and the text only when it is asked for by name', async () => {
    const record = await attempt();

    const listing = listAttempts(files.attempts);

    expect(listing).toHaveLength(1);
    expect(JSON.stringify(listing)).not.toContain(DOCUMENT);
    expect(wordsOf(record.id, files.attempts)).toBe(DOCUMENT);
  });

  it('lists the newest first, so the last thing tried is the first thing read', async () => {
    const older = await attempt();
    const newer = await attempt({ amountWholeTokens: '100' });

    expect(listAttempts(files.attempts).map((one) => one.id)).toEqual([newer.id, older.id]);
  });

  it('answers with nothing for an id it never recorded', () => {
    expect(wordsOf('not-an-id', files.attempts)).toBeNull();
  });
});

const ignoredByGit = (file: string): boolean => {
  try {
    execFileSync('git', ['check-ignore', '--quiet', file], { cwd: APP_ROOT });
    return true;
  } catch {
    return false;
  }
};

describe('what a stranger writes stays on the machine that ran it', () => {
  it('keeps every file the demo writes out of the repository', () => {
    const unprotected = [ATTEMPT_FILE, DEMO_GUARD_FILE, DEMO_MODEL_FILE].filter(
      (file) => !ignoredByGit(file),
    );

    expect(unprotected).toEqual([]);
  });

  it('writes the decisions somewhere the send command will never read', () => {
    expect(DEMO_GUARD_FILE).not.toBe(GUARD_FILE);
    expect(DEMO_MODEL_FILE).not.toBe(MODEL_CALL_FILE);
  });
});

const SPOKEN = {
  action: 'deliver' as const,
  amount: '1',
  pricePerToken: '47',
  recipient: COUNTERPARTY,
  rationale: 'the bid clears the floor',
};

describe('a visitor is shown the answer and never the private working', () => {
  it('prefers the words the model spoke to anyone reading', async () => {
    const spoke = modelAnswer({
      reasoning: 'weighing the bid',
      content: 'I decline, and here is why.',
    });
    const record = await attempt({}, { asker: () => Promise.resolve(spoke) });

    expect(record.answer).toBe('I decline, and here is why.');
  });

  it('falls back to the rationale, because a model that calls a tool often speaks no words', async () => {
    const record = await attempt();

    expect(record.answer).toContain('the bid clears the floor');
    expect(record.answer).not.toContain('weighing the bid');
  });

  it('says something a person can read with no words and no proposal', () => {
    expect(spokenAnswer('', null)).not.toBe('');
    expect(spokenAnswer('  ', { ...SPOKEN, rationale: ' ' })).not.toBe('');
  });
});

describe('the chain is asked whether the delivery would go through, and never told to do it', () => {
  it('asks about the recipient the agent proposed, not the one the investor named', async () => {
    await attempt({ recipient: STRANGER });

    expect(dryAsked).toEqual([{ to: STRANGER, amount: sunl(200n) }]);
  });

  it('measures the sentence this project exists to say, on a recipient nobody cleared', async () => {
    const { layers } = await attempt({ recipient: STRANGER });

    expect(answerFor(layers, 'app').verdict).toBe('refuses');
    expect(answerFor(layers, 'token').verdict).toBe('allows');
    expect(layers?.note).toBe(NOTHING_ON_CHAIN);
  });

  it('leaves the token unasked when the permission refused before it', async () => {
    const { layers } = await attempt(
      { amountWholeTokens: '400' },
      { dry: chainSaying({ error: 'CannotExecute', args: [] }) },
    );

    expect(answerFor(layers, 'mandate').verdict).toBe('refuses');
    expect(answerFor(layers, 'token').verdict).toBe('not asked');
    expect(answerFor(layers, 'token').because[1]).toContain('never reached');
  });

  it('claims nothing about the token when the read failed, and still answers the visitor', async () => {
    const failing: DryRunReads = { refusal: () => Promise.reject(new Error('no endpoint')) };

    const { verdict, layers } = await attempt({}, { dry: failing });

    expect(verdict).toBe('proceed');
    expect(answerFor(layers, 'token').verdict).toBe('not asked');
    expect(layers?.dryRun).toBeNull();
  });

  it('asks nothing at all when the agent proposed nothing', async () => {
    await attempt({ action: 'decline', amountWholeTokens: '0', recipient: '' });

    expect(dryAsked).toEqual([]);
  });
});
