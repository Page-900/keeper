import { whitelistHolder } from '../dist/brickken/tokenization.js';
import { HOLDER_EMAIL, SUNL_SYMBOL, explorerTransaction } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print(`Whitelisting the investor wallet to hold ${SUNL_SYMBOL}, under ${HOLDER_EMAIL}.`);
print('Brickken require the holder identity to differ from the issuer identity.');
print('');

try {
  const { txId, transactionHash } = await whitelistHolder();
  print(`  prepared    ${txId}`);
  print(`  transaction ${explorerTransaction(transactionHash)}`);
  print('');
  print('Brickken named the hash, this project read the chain for it, and it is in the log.');
} catch (cause) {
  print(`  not whitelisted: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
