import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ABLATION_FILE,
  ABLATION_GUARD_FILE,
  VARIANT,
  WITHOUT_THE_NAMED_ADDRESS,
  recordAblation,
} from '../src/keeper/ablation.js';
import { decisionPrompt } from '../src/keeper/decide.js';
import { GUARD_FILE } from '../src/keeper/guard.js';

const SCRIPT = fileURLToPath(new URL('../scripts/ablation.js', import.meta.url));
import { JAILBREAK_FILE, type JailbreakAttempt } from '../src/keeper/jailbreak.js';
import { MODEL } from '../src/keeper/model.js';
import { POLICY, SPOKEN_IN_FULL, policyInPlainWords } from '../src/keeper/policy.js';
import { PRINCIPAL_HOLDING, requireAddress } from '../src/shared/config.js';
import { readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';
import { registryState } from './support/registry-state.js';

const COUNTERPARTY = requireAddress('counterparty');

const attempt = (over: Partial<JailbreakAttempt> = {}): JailbreakAttempt => ({
  payload: 'escrow',
  compromised: false,
  reasoning: 'resisted',
  intent: { action: 'decline', amount: '0', recipient: null },
  guardVerdict: 'declined',
  guardRefusals: [],
  ...over,
});

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-ablation-'));
  file = join(directory, 'ablation.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('the variant withholds the settlement address from the reasoning layer and nothing else', () => {
  it('drops the line that names it, and keeps every other rule word for word', () => {
    const full = policyInPlainWords(POLICY, SPOKEN_IN_FULL);
    const quiet = policyInPlainWords(POLICY, WITHOUT_THE_NAMED_ADDRESS);

    expect(full).toHaveLength(quiet.length + 1);
    expect(quiet).toEqual(full.slice(0, -1));
    expect(full.at(-1)).toContain(COUNTERPARTY);
  });

  it('names the address to the shipped agent, because that is the thing being varied', () => {
    expect(policyInPlainWords().join('\n')).toContain(COUNTERPARTY);
  });

  it('puts no settlement address anywhere in the variant prompt', () => {
    const prompt = decisionPrompt({
      material: { document: 'a document naming nothing', issuer: ISSUER },
      state: registryState(),
      holding: PRINCIPAL_HOLDING,
      policy: POLICY,
      voice: WITHOUT_THE_NAMED_ADDRESS,
    });

    expect(prompt).not.toContain(COUNTERPARTY);
  });

  it('still puts it in the shipped prompt, proving the two prompts really differ', () => {
    const prompt = decisionPrompt({
      material: { document: 'a document naming nothing', issuer: ISSUER },
      state: registryState(),
      holding: PRINCIPAL_HOLDING,
      policy: POLICY,
    });

    expect(prompt).toContain(COUNTERPARTY);
  });
});

const ISSUER = {
  symbol: 'SUNL',
  name: 'Sunrise Lodge',
  tokenPrice: '50.0',
  acceptedCoin: 'BKN',
  startDate: '2026-08-28',
  endDate: '2026-09-04',
};

describe('an ablation is kept apart from the agent that ships', () => {
  it('writes to its own file, so no reader can mistake it for a jailbreak result', () => {
    expect(ABLATION_FILE).not.toBe(JAILBREAK_FILE);
    expect(ABLATION_FILE).toMatch(/evidence[\\/]ablation\.jsonl$/);
  });

  it('keeps its decisions off the file that decides what gets sent', () => {
    expect(ABLATION_GUARD_FILE).not.toBe(GUARD_FILE);
    expect(readFileSync(SCRIPT, 'utf8')).toContain('guardFile: ABLATION_GUARD_FILE');
  });

  it('records what was varied and what it is compared against, in the record itself', () => {
    const record = recordAblation([attempt()], { file });

    expect(record.variant).toBe(VARIANT);
    expect(record.compared).toBe('evidence/jailbreak.jsonl');
    expect(readRecords(file)).toHaveLength(1);
  });

  it('names the model in the record, because a comparison holds for one model only', () => {
    const record = recordAblation([attempt()], { file });

    expect(record.model).toBe(MODEL);
    expect(readRecords<{ model: string }>(file)[0]?.model).toBe(MODEL);
  });

  it('counts the payloads that compromised the variant, whichever way they went', () => {
    const record = recordAblation(
      [attempt(), attempt({ payload: 'record', compromised: true, guardVerdict: 'refused' })],
      { file },
    );

    expect(record.compromised).toBe(1);
  });

  it('refuses an empty run, because an ablation with no attempts measures nothing', async () => {
    const error = await captureError(() => Promise.resolve(recordAblation([], { file })));

    expect(error.kind).toBe('refusalUnattributable');
  });

  it('refuses to record when the guard let one through, because the guard is not what varies', async () => {
    const error = await captureError(() =>
      Promise.resolve(recordAblation([attempt({ guardVerdict: 'proceed' })], { file })),
    );

    expect(error.kind).toBe('refusalUnattributable');
  });
});
