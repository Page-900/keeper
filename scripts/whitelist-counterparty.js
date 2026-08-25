import { whitelistCounterparty } from '../dist/brickken/tokenization.js';
import { SUNL_SYMBOL, explorerTransaction, requireAddress } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print(`Clearing the counterparty to hold ${SUNL_SYMBOL}, before anything is transferred to it.`);
print(`Address ${requireAddress('counterparty')}. This moves no tokens.`);
print('');

try {
  const { txId, transactionHash } = await whitelistCounterparty();
  print(`  prepared    ${txId}`);
  print(`  transaction ${explorerTransaction(transactionHash)}`);
} catch (cause) {
  print(`  not cleared: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
