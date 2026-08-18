import { mintHolding } from '../dist/brickken/tokenization.js';
import {
  PRINCIPAL_HOLDING_WHOLE,
  SUNL_SYMBOL,
  explorerTransaction,
} from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print(
  `Minting ${PRINCIPAL_HOLDING_WHOLE} ${SUNL_SYMBOL} to the investor wallet. This happens once.`,
);
print('');

try {
  const { txId, transactionHash } = await mintHolding();
  print(`  prepared    ${txId}`);
  print(`  transaction ${explorerTransaction(transactionHash)}`);
  print('');
  print('Run npm run verify to read the balance back off the chain.');
} catch (cause) {
  print(`  not minted: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
