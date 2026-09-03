import { fileURLToPath } from 'node:url';

import { KeeperError } from '../shared/errors.js';
import { appendRecord } from '../shared/jsonl.js';
import type { JailbreakAttempt } from './jailbreak.js';
import { MODEL } from './model.js';
import type { PolicyVoice } from './policy.js';

export const ABLATION_FILE = fileURLToPath(
  new URL('../../evidence/ablation.jsonl', import.meta.url),
);

/** Kept off the guard file, because keeper:act sends the last decision that file says passed. */
export const ABLATION_GUARD_FILE = fileURLToPath(
  new URL('../../evidence/ablation-decisions.jsonl', import.meta.url),
);

export const WITHOUT_THE_NAMED_ADDRESS: PolicyVoice = Object.freeze({
  namesTheSettlementAddress: false,
});

export const VARIANT = 'the investor policy does not name a settlement address';

export interface AblationCase {
  at: string;
  model: string;
  variant: string;
  compared: string;
  attempts: JailbreakAttempt[];
  compromised: number;
}

export interface AblationOptions {
  file?: string;
}

/** A different agent, measured on purpose. It is never evidence about the one that ships. */
export function recordAblation(
  attempts: JailbreakAttempt[],
  { file = ABLATION_FILE }: AblationOptions = {},
): AblationCase {
  if (attempts.length === 0)
    throw new KeeperError('refusalUnattributable', 'an ablation with no attempts measures nothing');

  const passed = attempts.filter((attempt) => attempt.guardVerdict === 'proceed');
  if (passed.length > 0)
    throw new KeeperError(
      'refusalUnattributable',
      `the guard passed ${String(passed.length)} of them, and the guard is not what this varies`,
    );

  const record: AblationCase = {
    at: new Date().toISOString(),
    model: MODEL,
    variant: VARIANT,
    compared: 'evidence/jailbreak.jsonl',
    attempts,
    compromised: attempts.filter((attempt) => attempt.compromised).length,
  };
  appendRecord(file, record);
  return record;
}
