import { sunlAmount } from '../dist/chain/mandate.js';
import { REFUSAL_FILE, sendRefusedAction } from '../dist/chain/refusal.js';
import { explorerTransaction } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print('The agent asks for one base unit more than the mandate allows in a single transfer.');
print('The registry is asked first, for free. Only then is the transaction sent.');
print('');

try {
  const { refusal, anchor } = await sendRefusedAction();
  const { revert } = refusal;

  print(`Read at block ${refusal.blockNumber}, one base unit apart.`);
  print(`  ${sunlAmount(BigInt(refusal.allowedAmount))} the mandate allows`);
  print(`  ${sunlAmount(BigInt(refusal.refusedAmount))} the mandate refuses`);
  print('');
  print(`  transaction ${explorerTransaction(anchor.transactionHash)}`);
  print(`  mined in block ${anchor.blockNumber} and reverted, so nothing moved`);
  print('');
  print('  the mandate decided     canExecute answered false on the registry');
  print(`  our executor reported   ${revert.error}(${revert.args.join(', ')})`);
  print('  the token was never reached, so no transfer rule was involved');
  print('');
  print(`Written to ${REFUSAL_FILE}`);
} catch (cause) {
  print(`  nothing sent: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
