import { CHAIN, alreadyRun, runReplay, usedRevoke } from '../dist/chain/signatures.js';
import { explorerTransaction } from '../dist/shared/config.js';
import { BATTERY_LOCK, releaseLock, takeLock } from '../dist/shared/lock.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');

const held = takeLock('the replay');

if (!held.taken) {
  print(`  ${held.by} is already running, so this one stops.`);
  print('  Two drivers send from the same wallets and would collide on the nonce.');
  print(`  If nothing is running, delete ${BATTERY_LOCK} and try again.`);
  process.exit(1);
}

process.on('exit', () => {
  releaseLock();
});

print('R1, the replay, on the revoke signature and not on the grant.');
print('');
print('A replayed grant never reaches the signature check at all: the registry refuses it as a');
print('duplicate, or on its expiry, long before it looks at who signed. A revoke goes straight');
print('to the check, so the same bytes that worked once are the ones that fail here.');
print('');

try {
  if (alreadyRun('R1')) throw new Error('R1 is already recorded');

  const spent = usedRevoke();
  print(`  replaying the signature spent at replay number ${spent.nonceSigned}`);

  const record = await runReplay({ chain: CHAIN, agent: 'probe' });
  print(`  refused on ${record.revert.error}, submitted at replay number ${record.nonceBefore}`);
  print(`  block       ${record.blockNumber}`);
  print(`  transaction ${explorerTransaction(record.transactionHash)}`);
} catch (cause) {
  print(`  not recorded: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
