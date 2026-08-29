import {
  OFFERING_OPENS,
  heldOffering,
  openOffering,
  recordOpen,
} from '../dist/brickken/offering.js';
import { REHEARSAL } from '../dist/shared/tokens.js';
import { explorerTransaction } from '../dist/shared/config.js';

const print = (text) =>
  process.stdout.write(`${text}
`);
const STARTS_IN = 15 * 60;
const RUNS_FOR = 3 * 60 * 60;

const open = async () => {
  try {
    const opened = await openOffering('open-rehearsal-offering', {
      spec: REHEARSAL,
      startsIn: STARTS_IN,
      runsFor: RUNS_FOR,
    });
    print(`  sent      ${opened.transactionHash}`);
    print(`  ${explorerTransaction(opened.transactionHash)}`);
  } catch (cause) {
    if (cause?.kind !== 'alreadyCreated') throw cause;
    print(`  already opened, so nothing was sent: ${cause.detail}`);
  }
};

print('');
print(`Opening an offering on ${REHEARSAL.symbol}. This one really sends.`);
print('It starts in fifteen minutes and runs three hours, so both halves can be tested.');
print('');

try {
  await open();
  const held = await heldOffering(REHEARSAL);
  if (held === null) throw new Error(`Brickken list no offering on ${REHEARSAL.symbol}`);
  recordOpen(OFFERING_OPENS, REHEARSAL, held);
  print('');
  print('  Brickken hold it as:');
  print(`  ${held.name}, ${held.status}, at ${held.tokenPrice} per token in ${held.acceptedCoin}`);
  print(`  opens     ${held.startDate}`);
  print(`  closes    ${held.endDate}`);
  print('');
  print('  Try to close it: npm run rehearsal:close');
} catch (cause) {
  print(`  not opened: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
