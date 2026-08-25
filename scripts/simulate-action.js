import { firstAction, simulateAgentAction } from '../dist/chain/action.js';
import { MAX_CUMULATIVE_VALUE, SUNL_DECIMALS, SUNL_SYMBOL } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);
const whole = (amount) => amount / 10n ** BigInt(SUNL_DECIMALS);

const action = firstAction();

print('');
print(`Asking the chain what would happen, without sending anything and without paying.`);
print(`  move    ${whole(action.amount)} ${SUNL_SYMBOL}`);
print(`  to      ${action.to}`);
print('');

try {
  await simulateAgentAction(action);
  print('  ALLOWED. The chain runs this call without reverting.');
} catch (cause) {
  print(`  REFUSED: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
print('Checking that this test can fail, by asking for more than the mandate permits.');

try {
  await simulateAgentAction({ ...action, amount: MAX_CUMULATIVE_VALUE * 2n });
  print('  ALLOWED, which is wrong. Do not send anything.');
  process.exitCode = 1;
} catch {
  print(`  REFUSED, as it must be. ${whole(MAX_CUMULATIVE_VALUE * 2n)} is over every cap.`);
}

print('');
