import { confirmAnchor } from '../dist/chain/anchors.js';
import { explorerTransaction } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);
const [action, hash] = process.argv.slice(2);

print('');
print(`Reading the chain for ${hash} and recording what it says.`);
print('');

try {
  const anchor = await confirmAnchor(action, hash);
  print(`  status      ${anchor.status}`);
  print(`  block       ${anchor.blockNumber}`);
  print(`  contract    ${anchor.contract ?? 'none, the transaction deployed nothing directly'}`);
  print(`  transaction ${explorerTransaction(anchor.transactionHash)}`);
} catch (cause) {
  print(`  not confirmed: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
