import { CHAIN, afterRevocation, alreadyRun, runCase } from '../dist/chain/cases.js';
import { readRegistryState } from '../dist/chain/registry.js';
import { setTimeout as sleep } from 'node:timers/promises';

import { BATTERY_LOCK, releaseLock, takeLock } from '../dist/shared/lock.js';

import {
  CHAIN as SIGNATURE_CHAIN,
  REVOKE_CASE,
  alreadyRun as signatureRun,
  runExpiredDeadline,
  runRevoke,
} from '../dist/chain/signatures.js';
import { PROBE_MANDATE, explorerTransaction } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);
const AGENT = 'probe';
const signatures = { chain: SIGNATURE_CHAIN, agent: AGENT };

const state = () => readRegistryState({ agent: AGENT });

const waitUntil = async (seconds, what) => {
  for (;;) {
    const now = BigInt((await state()).blockTimestamp);
    if (now >= seconds) return;
    const left = Number(seconds - now);
    print(`  waiting ${left}s for ${what}`);
    await sleep(Math.min(left, 30) * 1000 + 2000);
  }
};

print('');

const held = takeLock('cycle two');

if (!held.taken) {
  print(`  ${held.by} is already running, so this one stops.`);
  print('  Two drivers send from the same wallets and would collide on the nonce.');
  print(`  If nothing is running, delete ${BATTERY_LOCK} and try again.`);
  process.exit(1);
}

process.on('exit', () => {
  releaseLock();
});

print('The negative path battery, cycle two, on a freshly granted probe mandate.');
print('It proves the two refusals that live on the signature and not on the caps.');
print('');

try {
  const before = await state();
  if (!before.mandateGranted) throw new Error('the probe mandate is not granted yet');
  if (before.mandateRevoked) throw new Error('the probe mandate is already revoked');

  if (signatureRun('D1')) {
    print('  D1 already recorded, skipping');
  } else {
    const d1 = await runExpiredDeadline(signatures);
    print(
      `  D1 refused on ${d1.revert.error}, deadline ${d1.deadline} against block ${d1.clockBefore}`,
    );
    print(`     ${explorerTransaction(d1.transactionHash)}`);
  }

  await waitUntil(BigInt(before.mandateValidFrom), 'the window to open');

  if (signatureRun(REVOKE_CASE)) {
    print('  the revoke is already spent, skipping');
  } else {
    const revoke = await runRevoke(signatures);
    print(`  revoked, and the signature that did it is kept for the replay`);
    print(`     ${explorerTransaction(revoke.transactionHash)}`);
  }

  const v1 = afterRevocation(PROBE_MANDATE);
  if (alreadyRun(v1.name)) {
    print(`  ${v1.name} already recorded, skipping`);
  } else {
    const record = await runCase(v1, { chain: CHAIN, agent: AGENT });
    print(`  ${v1.name} refused on ${record.firstFalse}`);
    print(`     ${explorerTransaction(record.transactionHash)}`);
  }

  print('');
  print('Cycle two is done as far as it can go on this mandate.');
  print('Next, in this order: npm run mandate:grant-probe 3, then npm run battery:replay.');
} catch (cause) {
  print('');
  print(`  stopped: ${cause instanceof Error ? cause.message : cause}`);
  print('  Nothing already recorded is lost. Run it again to continue from here.');
  process.exitCode = 1;
}

print('');
