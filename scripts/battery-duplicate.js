import { CHAIN, alreadyRun, runDuplicateGrant } from '../dist/chain/signatures.js';
import { readRegistryState } from '../dist/chain/registry.js';

import { explorerTransaction } from '../dist/shared/config.js';
import { BATTERY_LOCK, releaseLock, takeLock } from '../dist/shared/lock.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');

const held = takeLock('the duplicate grant');

if (!held.taken) {
  print(`  ${held.by} is already running, so this one stops.`);
  print('  Two drivers send from the same wallets and would collide on the nonce.');
  print(`  If nothing is running, delete ${BATTERY_LOCK} and try again.`);
  process.exit(1);
}

process.on('exit', () => {
  releaseLock();
});

print('X4, a second permission granted on top of one that is still live.');
print('');
print('The registry checks for a duplicate before it looks at who signed, so this proves');
print('nothing about signatures and everything about the order the checks run in.');
print('');
print('It only means anything while the first permission is live. If that one has expired');
print('or been revoked, a second grant is accepted, so this refuses to send instead.');
print('');

try {
  if (alreadyRun('X4')) throw new Error('X4 is already recorded');

  const before = await readRegistryState({ agent: 'probe' });
  const left = Number(before.mandateValidUntil) - Number(before.blockTimestamp);
  print(`  the permission it would duplicate has ${left}s left on it`);

  const record = await runDuplicateGrant({ chain: CHAIN, agent: 'probe' });
  print(`  refused on ${record.revert.error}`);
  print(`  block       ${record.blockNumber}`);
  print(`  transaction ${explorerTransaction(record.transactionHash)}`);
} catch (cause) {
  print(`  not recorded: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
