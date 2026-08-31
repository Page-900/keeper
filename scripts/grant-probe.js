import { grantMandate } from '../dist/brickken/grant.js';
import { PROBE_MANDATE, explorerTransaction } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);
const cycle = Number(process.argv[2] ?? '1');

print('');

if (!Number.isInteger(cycle) || cycle < 1) {
  print(`  A cycle number is a whole number from 1. Given: ${process.argv[2]}`);
  process.exitCode = 1;
} else {
  print(`Granting the probe mandate, cycle ${cycle}, signed by the investor.`);
  print('Tiny on purpose: 1 SUNL at a time and 2 SUNL in total, ever.');
  print('It is a separate mandate and it takes nothing from the investor own authority.');
  print('');
  const NEXT = {
    1: 'battery:cycle-one',
    2: 'battery:cycle-two',
    3: 'battery:replay',
    4: 'battery:duplicate',
  };
  const next = NEXT[cycle] ?? 'battery:cycle-one';
  print(`The window opens 15 minutes from now. Run npm run ${next} straight after this,`);
  print('because its first case has to act before the window opens.');
  print('');

  try {
    const { txId, transactionHash } = await grantMandate({
      spec: PROBE_MANDATE,
      action: `grant-probe-${cycle}`,
    });
    print(`  prepared    ${txId}`);
    print(`  transaction ${explorerTransaction(transactionHash)}`);
    print('');
    print(`Now run npm run ${next}.`);
  } catch (cause) {
    print(`  not granted: ${cause instanceof Error ? cause.message : cause}`);
    process.exitCode = 1;
  }
}

print('');
