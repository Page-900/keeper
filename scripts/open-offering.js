import { openAndRecord } from '../dist/brickken/offering.js';
import { SUNL } from '../dist/shared/tokens.js';
import {
  OFFERING_AMOUNT_WHOLE,
  OFFERING_COIN,
  explorerTransaction,
} from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print(`Opening an offering on ${SUNL.symbol}. This sends, and it cannot be undone.`);
print(
  `${OFFERING_AMOUNT_WHOLE} ${SUNL.symbol} offered for ${OFFERING_COIN}, out of unissued supply.`,
);
print('It can only be closed once it has ended, which is why the window is short.');
print('');

try {
  const { opened, record } = await openAndRecord('open-offering', { spec: SUNL });
  if (opened === null) {
    print('  Already open, so nothing was sent. Recording what Brickken hold.');
  } else {
    print(`  sent      ${opened.transactionHash}`);
    print(`  ${explorerTransaction(opened.transactionHash)}`);
  }
  print('');
  print('  Brickken read it back as:');
  print(`  ${record.name}, at ${record.tokenPrice} per token in ${record.acceptedCoin}`);
  print(`  opens     ${record.startDate}`);
  print(`  closes    ${record.endDate}`);
} catch (cause) {
  print(`  not opened: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
