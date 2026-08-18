import { createToken } from '../dist/brickken/tokenization.js';
import { SUNL_SYMBOL, explorerTransaction } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print(`Creating ${SUNL_SYMBOL} on the Brickken sandbox. This happens once and cannot be undone.`);
print('The principal wallet signs it, so the principal becomes the tokenizer.');
print('');

try {
  const { txId, transactionHash } = await createToken();
  print(`  prepared    ${txId}`);
  print(`  transaction ${explorerTransaction(transactionHash)}`);
  print('');
  print('Brickken named the hash, this project read the chain for it, and it is in the log.');
  print(`The ${SUNL_SYMBOL} contract address is read and verified in the next step.`);
} catch (cause) {
  print(`  not created: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
