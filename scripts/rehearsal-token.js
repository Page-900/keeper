import { createToken } from '../dist/brickken/tokenization.js';
import { REHEARSAL } from '../dist/shared/tokens.js';
import { explorerTransaction } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print(`Creating ${REHEARSAL.symbol}, a disposable token. SUNL is not touched by this.`);
print('It exists so an irreversible answer is learned somewhere that carries nothing.');
print('');

try {
  const { txId, transactionHash } = await createToken({}, REHEARSAL, 'create-rehearsal-token');
  print(`  prepared  ${txId}`);
  print(`  sent      ${transactionHash}`);
  print(`  ${explorerTransaction(transactionHash)}`);
} catch (cause) {
  print(`  not created: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
