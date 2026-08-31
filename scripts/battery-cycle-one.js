import {
  CHAIN,
  alreadyRun,
  cycleOne,
  legalAlreadySent,
  legalRuns,
  runCase,
  runLegal,
} from '../dist/chain/cases.js';
import { readRegistryState } from '../dist/chain/registry.js';
import { setTimeout as sleep } from 'node:timers/promises';

import { BATTERY_LOCK, releaseLock, takeLock } from '../dist/shared/lock.js';

import { PROBE_MANDATE, explorerTransaction } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);
const AGENT = 'probe';
const run = { chain: CHAIN, agent: AGENT };

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

const runOne = async (spec) => {
  if (alreadyRun(spec.name)) {
    print(`  ${spec.name} already recorded, skipping`);
    return;
  }
  const record = await runCase(spec, run);
  print(`  ${spec.name} refused on ${record.firstFalse}`);
  print(`     ${explorerTransaction(record.transactionHash)}`);
};

print('');

const held = takeLock('cycle one');

if (!held.taken) {
  print(`  ${held.by} is already running, so this one stops.`);
  print('  Two drivers send from the same wallets and would collide on the nonce.');
  print(`  If nothing is running, delete ${BATTERY_LOCK} and try again.`);
  process.exit(1);
}

process.on('exit', () => {
  releaseLock();
});

print('The negative path battery, cycle one, on the probe mandate.');
print('Every case here is a refusal and a refusal spends nothing from the investor mandate.');
print('It is resumable: anything already recorded is skipped, so a dropped connection is safe.');
print('');

try {
  const before = await state();
  if (!before.mandateGranted) throw new Error('the probe mandate is not granted yet');

  const [t1, c1, a1, s1, c2, t2] = cycleOne(PROBE_MANDATE);
  const opens = BigInt(before.mandateValidFrom);
  const closes = BigInt(before.mandateValidUntil);

  print(`  probe mandate opens at ${opens}, closes at ${closes}`);
  print('');

  await runOne(t1);
  await waitUntil(opens, 'the window to open');

  await runOne(c1);
  await runOne(a1);
  await runOne(s1);

  for (const legal of legalRuns(PROBE_MANDATE)) {
    if (legalAlreadySent(legal.name)) {
      print(`  ${legal.name} already sent, skipping`);
      continue;
    }
    const done = await runLegal(legal, run);
    print(`  ${legal.name} allowed, ${explorerTransaction(done.transactionHash)}`);
  }

  await runOne(c2);

  await waitUntil(closes + 1n, 'the window to close');
  await runOne(t2);

  print('');
  print('Cycle one is complete. Run npm run verify to read it back.');
} catch (cause) {
  print('');
  print(`  stopped: ${cause instanceof Error ? cause.message : cause}`);
  print('  Nothing already recorded is lost. Run it again to continue from here.');
  process.exitCode = 1;
}

print('');
