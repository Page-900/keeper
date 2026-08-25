import { firstAction, simulateAgentAction } from '../dist/chain/action.js';
import { sunlAmount } from '../dist/chain/mandate.js';
import { REFUSAL_FILE, recordRefusal } from '../dist/chain/refusal.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print('Nothing here is sent and nothing is signed. Every answer is read off the chain.');
print('');

try {
  await simulateAgentAction(firstAction());
  print(`  ${sunlAmount(firstAction().amount)} runs end to end without reverting.`);
} catch (cause) {
  print(`  the allowed amount was refused: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');

try {
  const refusal = await recordRefusal();
  const { revert } = refusal;

  print(`Read at block ${refusal.blockNumber}, one base unit apart.`);
  print(`  ${sunlAmount(BigInt(refusal.allowedAmount))} the mandate allows`);
  print(`  ${sunlAmount(BigInt(refusal.refusedAmount))} the mandate refuses`);
  print('');
  print('The amount is the only thing that changed, so the per transaction cap is the only');
  print('rule that can account for the difference.');
  print('');
  print('  the mandate decided     canExecute answered false on the registry');
  print(`  our executor reported   ${revert.error}(${revert.args.join(', ')})`);
  print('  the token was never reached, so no transfer rule was involved');
  print('');
  print(`Written to ${REFUSAL_FILE}`);
} catch (cause) {
  print(`  nothing recorded: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
