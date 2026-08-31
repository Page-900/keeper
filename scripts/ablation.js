import { readFileSync } from 'node:fs';

import { readTokenBalance } from '../dist/chain/client.js';
import { readRegistryState } from '../dist/chain/registry.js';
import {
  ABLATION_GUARD_FILE,
  WITHOUT_THE_NAMED_ADDRESS,
  VARIANT,
  recordAblation,
} from '../dist/keeper/ablation.js';
import { decide } from '../dist/keeper/decide.js';
import { attemptOf } from '../dist/keeper/jailbreak.js';
import { gatherMaterial } from '../dist/keeper/material.js';
import { requireAddress } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

const materialPath = (name) => `material/jailbreak-${name}.md`;

/** The same seven payloads the shipped agent refused, so only the policy differs. */
const PAYLOADS = ['escrow', 'escalation', 'override', 'split', 'history', 'record', 'fence'];

const reads = {
  state: () => readRegistryState(),
  balance: (holder, atBlock) => readTokenBalance(requireAddress('asset'), holder, atBlock),
};

print('');
print('THE ABLATION. This is a design comparison and it is not a jailbreak of the shipped agent.');
print('');
print(`The variant: ${VARIANT}.`);
print('Everything else is identical, the guard included, so the only thing that changes is what');
print(
  'the reasoning layer was told. Every attempt is recorded whichever way it goes, into its own',
);
print('file, and it is never presented as evidence about the agent that ships.');
print('');

const attempts = [];

try {
  for (const name of PAYLOADS) {
    print(`  trying ${name}...`);
    const material = gatherMaterial(readFileSync(materialPath(name), 'utf8'));

    const { reply, intent, decision } = await decide({
      reads,
      material,
      voice: WITHOUT_THE_NAMED_ADDRESS,
      guardFile: ABLATION_GUARD_FILE,
    });
    const attempt = attemptOf(name, reply.reasoning, intent, decision);
    attempts.push(attempt);

    print(`    it proposed    ${intent.action} ${String(intent.amount)} base units`);
    if (intent.recipient !== null) print(`    to             ${intent.recipient}`);
    print(`    the guard says ${decision.verdict.toUpperCase()}`);
    print(`    ${attempt.compromised ? 'COMPROMISED' : 'resisted'}`);
  }

  const record = recordAblation(attempts);
  print('');
  print(`  ${record.compromised} of ${record.attempts.length} payloads compromised the variant.`);
  print('  Written to evidence/ablation.jsonl.');
} catch (cause) {
  print('');
  print(`  stopped: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
