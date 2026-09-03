import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { GuardRefusal, Verdict } from '../keeper/guard.js';
import type { Intent } from '../keeper/intent.js';
import { appendRecord, readRecords } from '../shared/jsonl.js';
import type { LayerWalk } from './layers.js';

const evidence = (name: string): string =>
  fileURLToPath(new URL(`../../evidence/${name}`, import.meta.url));

export const ATTEMPT_FILE = evidence('demo-attempts.jsonl');

/** The send command replays the last decision its own guard file passed. Never this one. */
export const DEMO_GUARD_FILE = evidence('demo-decisions.jsonl');

export const DEMO_MODEL_FILE = evidence('demo-model-calls.jsonl');

export interface AttemptIntent {
  action: Intent['action'];
  amount: string;
  pricePerToken: string;
  recipient: `0x${string}` | null;
  rationale: string;
}

const NOTHING_SAID = 'It answered without words and proposed nothing.';

export function spokenAnswer(text: string, intent: AttemptIntent | null): string {
  const said = text.trim();
  if (said !== '') return said;
  const rationale = intent?.rationale.trim() ?? '';
  return rationale === '' ? NOTHING_SAID : rationale;
}

export interface Attempt {
  at: string;
  id: string;
  said: string;
  answer: string;
  reasoning: string;
  intent: AttemptIntent | null;
  verdict: Verdict | null;
  refusals: GuardRefusal[];
  layers: LayerWalk | null;
}

export type AttemptClaim = Omit<Attempt, 'at' | 'id'>;

export function recordAttempt(file: string, claim: AttemptClaim): Attempt {
  const attempt: Attempt = { at: new Date().toISOString(), id: randomUUID(), ...claim };
  appendRecord(file, attempt);
  return attempt;
}

export type ListedAttempt = Omit<Attempt, 'said'>;

export const withoutWords = (attempt: Attempt): ListedAttempt => ({
  at: attempt.at,
  id: attempt.id,
  answer: attempt.answer,
  reasoning: attempt.reasoning,
  intent: attempt.intent,
  verdict: attempt.verdict,
  refusals: attempt.refusals,
  layers: attempt.layers,
});

/** A stranger's own words are served when they are asked for by name, and never in the list. */
export const listAttempts = (file: string = ATTEMPT_FILE): ListedAttempt[] =>
  readRecords<Attempt>(file).map(withoutWords).reverse();

export const wordsOf = (id: string, file: string = ATTEMPT_FILE): string | null =>
  readRecords<Attempt>(file).find((attempt) => attempt.id === id)?.said ?? null;
