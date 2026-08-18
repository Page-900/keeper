import { registerAction } from '../dist/chain/executor.js';
import { PERMITTED_ACTION, explorerTransaction } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print(`Registering ${PERMITTED_ACTION.signature} on the deployed agent executor.`);
print('It spends test network gas from the principal wallet, which owns the executor.');
print('');

try {
  const { transactionHash, blockNumber, spec } = await registerAction();
  print(`  selector    ${PERMITTED_ACTION.selector}`);
  print(`  block       ${blockNumber}`);
  print(`  transaction ${explorerTransaction(transactionHash)}`);
  print('');
  print(`  supported   ${spec.supported}`);
  print(`  hasAmount   ${spec.hasAmount}`);
  print(`  amountIndex ${spec.amountIndex}`);
  print('');
  print('All three were read back off the chain and match what this project meant to write.');
} catch (cause) {
  print(`  not registered: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
