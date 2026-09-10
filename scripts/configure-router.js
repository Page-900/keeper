import { allowRecipient, routeAction, ROUTED_ACTIONS } from '../dist/chain/router.js';
import { explorerTransaction, requireAddress } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print(`Configuring the settlement router at ${requireAddress('router')}.`);
print(
  'Every write is signed by the investor wallet, which owns it. The agent cannot change any of it.',
);
print('');

try {
  for (const action of ROUTED_ACTIONS) {
    const { transactionHash, blockNumber } = await routeAction(action);
    print(`  ${action.signature}`);
    print(`    recipient argument ${action.recipientIndex}, block ${blockNumber}`);
    print(`    ${explorerTransaction(transactionHash)}`);
  }

  const buyer = requireAddress('counterparty');
  const { transactionHash, blockNumber } = await allowRecipient('counterparty');
  print(`  allowed recipient ${buyer}`);
  print(`    block ${blockNumber}`);
  print(`    ${explorerTransaction(transactionHash)}`);
  print('');
  print('Every setting was read back off the chain and matches.');
} catch (cause) {
  print(`  not configured: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
