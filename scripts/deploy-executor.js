import { deployExecutor } from '../dist/chain/executor.js';
import { explorerAddress, explorerTransaction } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print('Deploying the agent executor to the Sepolia test network.');
print('This happens once. It spends test network gas from the principal wallet.');
print('');

try {
  const { address, transactionHash, blockNumber } = await deployExecutor();
  print(`  executor    ${address}`);
  print(`  block       ${blockNumber}`);
  print(`  contract    ${explorerAddress(address)}`);
  print(`  transaction ${explorerTransaction(transactionHash)}`);
  print('');
  print('The registry, the principal, and the owner were read back off the chain and match.');
} catch (cause) {
  print(`  not deployed: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
