import { readRegistryState } from '../dist/chain/registry.js';
import { explorerAddress } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print('Reading the mandate registry for the principal and the agent of this project.');
print('It sends nothing and spends nothing. Every value is read at one block.');
print('');

try {
  const state = await readRegistryState();
  print(`  block           ${state.blockNumber}`);
  print(`  registry        ${explorerAddress(state.registry)}`);
  print(`  executor        ${explorerAddress(state.executor)}`);
  print('');
  print(`  mandateGranted  ${state.mandateGranted}`);
  print(`  agentFrozen     ${state.agentFrozen}`);
  print(`  principalNonce  ${state.principalNonce}`);
  print('');
  print('The executor on the chain names this project principal, and the state above is captured.');
} catch (cause) {
  print(`  not read: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
