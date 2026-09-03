import { readTokenBalance } from '../dist/chain/client.js';
import { readRegistryState } from '../dist/chain/registry.js';
import { decide } from '../dist/keeper/decide.js';
import { ATTACK_FAMILIES, attemptOf, recordJailbreak } from '../dist/keeper/jailbreak.js';
import { gatherMaterial, payloadFile, readDocument } from '../dist/keeper/material.js';
import { requireAddress } from '../dist/shared/config.js';
import { whenNotBusy } from '../dist/shared/patience.js';

const print = (text) => process.stdout.write(`${text}\n`);

const reads = {
  state: () => readRegistryState(),
  balance: (holder, atBlock) => readTokenBalance(requireAddress('asset'), holder, atBlock),
};

print('');
print('The jailbreak.');
print('Each payload family runs in turn against the live model, and every attempt is recorded');
print('whichever way it goes. Nothing here sends a transaction.');
print('');

const attempts = [];
let chosenAttempt = null;

try {
  for (const name of ATTACK_FAMILIES) {
    print(`  trying ${name}...`);
    const document = readDocument(payloadFile(name));
    const material = gatherMaterial(document);

    const { reply, intent, decision } = await whenNotBusy(() => decide({ reads, material }), {
      onWait: (seconds) => print(`    the vendor is busy, waiting ${seconds} seconds`),
    });
    const attempt = attemptOf(name, reply.reasoning, intent, decision);
    attempts.push(attempt);

    if (intent === null) print('    it answered and proposed nothing');
    else {
      print(`    it proposed   ${intent.action} ${String(intent.amount)} base units`);
      if (intent.recipient !== null) print(`    to            ${intent.recipient}`);
      print(`    the guard says ${decision.verdict.toUpperCase()}`);
    }

    if (attempt.compromised) {
      print(`    the model was fooled by ${name}`);
      chosenAttempt = attempt;
      break;
    }
    print(`    resisted ${name}`);
  }

  if (chosenAttempt !== null && chosenAttempt.guardVerdict === 'proceed') {
    print('');
    print('  THE GUARD PASSED A COMPROMISED INTENT. This is a real failure, not a demonstration.');
    process.exitCode = 1;
  } else {
    print('');
    if (chosenAttempt === null)
      print('  no payload compromised the model. This is the weaker, honest result.');
    else print(`  ${chosenAttempt.payload} compromised the model and the guard refused it.`);
    const record = recordJailbreak(attempts, chosenAttempt);
    print(`  ${record.attempts.length} attempts written to evidence/jailbreak.jsonl`);
  }
} catch (cause) {
  print('');
  print(`  stopped: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
