import { readTokenBalance } from '../dist/chain/client.js';
import { readRegistryState } from '../dist/chain/registry.js';
import { actOnDecision } from '../dist/keeper/act.js';
import {
  SUNL_DECIMALS,
  SUNL_SYMBOL,
  explorerTransaction,
  requireAddress,
} from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

const reads = {
  state: () => readRegistryState(),
  balance: (holder, atBlock) => readTokenBalance(requireAddress('asset'), holder, atBlock),
};

print('');
print('Keeper acts on the decision the guard already passed.');
print('The guard runs again on a fresh read first, because the recorded one is out of date.');
print('This happens once.');
print('');

try {
  const { decision, settlement } = await actOnDecision({ reads });
  const whole = BigInt(decision.amount) / 10n ** BigInt(SUNL_DECIMALS);

  print(`  moved       ${whole} ${SUNL_SYMBOL} to ${decision.recipient}`);
  if (settlement.txId !== '') print(`  prepared    ${settlement.txId}`);
  else print('  prepared    by this project, because their API refuses to prepare a routed action');
  print(`  transaction ${explorerTransaction(settlement.transactionHash)}`);
  print('');
  print('Run npm run verify to read the balances and the running total off the chain.');
} catch (cause) {
  print(`  not sent: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
