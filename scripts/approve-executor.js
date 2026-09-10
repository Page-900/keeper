import { approveExecutor } from '../dist/brickken/tokenization.js';
import { APPROVAL_FILE, recordApproval } from '../dist/chain/approvals.js';
import { drawnEver } from '../dist/chain/drawn.js';
import { readRegistryState } from '../dist/chain/registry.js';
import {
  PRINCIPAL_HOLDING,
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
  const again = process.argv.includes('--again');
  const before = await readRegistryState();
  const drawnBefore = await drawnEver();
  const { txId, transactionHash } = await approveExecutor(
    {},
    again ? 'approve-executor-2' : 'approve-executor',
  );
  recordApproval(APPROVAL_FILE, {
    amount: String(PRINCIPAL_HOLDING),
    atBlock: before.blockNumber,
    drawnBefore: String(drawnBefore),
  });
  print(`  drawn so far ${drawnBefore / 10n ** 18n} ${SUNL_SYMBOL}, kept beside the approval`);
  print(`  prepared    ${txId}`);
  print(`  transaction ${explorerTransaction(transactionHash)}`);
  print('');
  print('Run npm run verify to read the allowance back off the chain.');
} catch (cause) {
  print(`  not approved: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
