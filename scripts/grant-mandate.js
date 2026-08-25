import { grantMandate } from '../dist/brickken/grant.js';
import { explorerTransaction } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print('Granting the mandate through Brickken, signed by the investor.');
print('This is a real transaction and it happens once.');
print('');

try {
  const { txId, transactionHash } = await grantMandate();
  print(`  prepared    ${txId}`);
  print(`  transaction ${explorerTransaction(transactionHash)}`);
  print('');
  print('Run npm run verify to read the granted mandate back off the chain.');
} catch (cause) {
  print(`  not granted: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
