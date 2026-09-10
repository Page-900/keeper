import { deployRouter } from '../dist/chain/executor.js';
import { explorerAddress, explorerTransaction } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print('Deploying the settlement router to the Sepolia test network.');
print('This happens once. It spends test network gas from the principal wallet.');
print('It grants nothing: until a mandate names it, the router can do nothing at all.');
print('');

const at = process.argv.indexOf('--replaces');
const replaces = at === -1 ? undefined : process.argv[at + 1];

if (replaces !== undefined)
  print(`Replacing the router at ${replaces}, which stays in the record.`);

try {
  const { address, transactionHash, blockNumber } = await deployRouter(
    replaces === undefined ? {} : { replaces },
  );
  print(`  router      ${address}`);
  print(`  block       ${blockNumber}`);
  print(`  contract    ${explorerAddress(address)}`);
  print(`  transaction ${explorerTransaction(transactionHash)}`);
  print('');
  print('The executor, the agent wallet, and the owner were read back off the chain and match.');
  print('Put the address in the router slot of the config module before anything else.');
} catch (cause) {
  print(`  not deployed: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
