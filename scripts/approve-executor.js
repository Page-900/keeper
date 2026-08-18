import { approveExecutor } from '../dist/brickken/tokenization.js';
import {
  PRINCIPAL_HOLDING_WHOLE,
  SUNL_SYMBOL,
  explorerTransaction,
  requireAddress,
} from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print(
  `Approving the executor to spend ${PRINCIPAL_HOLDING_WHOLE} ${SUNL_SYMBOL} from the investor.`,
);
print(`Spender ${requireAddress('executor')}. This moves no tokens.`);
print('');

try {
  const { txId, transactionHash } = await approveExecutor();
  print(`  prepared    ${txId}`);
  print(`  transaction ${explorerTransaction(transactionHash)}`);
  print('');
  print('Run npm run verify to read the allowance back off the chain.');
} catch (cause) {
  print(`  not approved: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
