import { MODEL, MODEL_CALL_FILE, MODEL_KEY_VARIABLE, askModel } from '../dist/keeper/model.js';
import { readRecords } from '../dist/shared/jsonl.js';
import { readSecret } from '../dist/shared/secrets.js';

const print = (text) => process.stdout.write(`${text}\n`);

const LABELS = {
  'x-ratelimit-limit-requests': 'requests a day',
  'x-ratelimit-remaining-requests': 'requests left',
  'x-ratelimit-reset-requests': 'requests reset in',
  'x-ratelimit-limit-tokens': 'tokens a minute',
  'x-ratelimit-remaining-tokens': 'tokens left',
  'x-ratelimit-reset-tokens': 'tokens reset in',
};

print('');
print(`Asking ${MODEL} the smallest question there is, to read what the account still allows.`);
print('');

readSecret(MODEL_KEY_VARIABLE);

try {
  await askModel({ system: 'Answer with one word.', user: 'ping', tools: [] });
} catch (error) {
  print(`  the vendor refused: ${error.message}`);
  print('');
}

const last = readRecords(MODEL_CALL_FILE).at(-1);
const budget = last?.budget ?? null;

if (budget === null) {
  print('  The vendor stated no allowance, so nothing is known and nothing is assumed.');
} else {
  for (const [name, value] of Object.entries(budget))
    print(`  ${(LABELS[name] ?? name).padEnd(20)} ${value}`);
}

print('');
print(`Recorded in ${MODEL_CALL_FILE}`);
print('');
