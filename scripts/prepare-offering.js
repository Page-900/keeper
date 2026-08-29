import { OFFERING_FILE, prepareOffering, recordOffering } from '../dist/brickken/drawdown.js';
import {
  OFFERING_AMOUNT_WHOLE,
  OFFERING_COIN,
  SUNL_DECIMALS,
  SUNL_SYMBOL,
} from '../dist/shared/config.js';

const UNIT = 10n ** BigInt(SUNL_DECIMALS);
const print = (text) => process.stdout.write(`${text}\n`);

const READING = {
  scaled: `Brickken read ${OFFERING_AMOUNT_WHOLE} as whole tokens, which is what this project meant.`,
  unscaled: `Brickken read ${OFFERING_AMOUNT_WHOLE} as base units. The offering would be dust.`,
  absent: 'Neither figure appears in the calldata. Nothing is assumed about how they read it.',
};

const VERDICT = {
  untouched:
    'THE OFFERING DOES NOT TOUCH THE INVESTOR HOLDING. The balance is the same on both sides of it.',
  reduced: 'THE OFFERING DRAWS THE INVESTOR HOLDING DOWN. Do not send it against this token.',
  increased: 'The offering raises the investor holding. Read the numbers before anything is sent.',
  undetermined:
    'A prepared call did not go through in the run, so the balance after it proves nothing.',
};

print('');
print(`Asking Brickken what opening an offering on ${SUNL_SYMBOL} would send, without sending it.`);
print('Preparing broadcasts nothing, spends no gas, and opens no offering.');
print('');

try {
  const prepared = await prepareOffering();
  print(`  prepared     ${prepared.txId}`);
  print(`  offering     ${OFFERING_AMOUNT_WHOLE} ${SUNL_SYMBOL} for ${OFFERING_COIN}`);
  print(`  opens        ${prepared.window.startDate}`);
  print(`  closes       ${prepared.window.endDate}`);
  print(`  transactions ${prepared.calls.length}`);
  for (const [index, call] of prepared.calls.entries()) {
    print(`  ${index + 1}. to ${call.to} (${call.target}), ${call.selector}, ${call.bytes} bytes`);
  }
  print('');
  print(`  amount       ${prepared.amount}`);
  print(`  ${READING[prepared.amount]}`);
  print('');
  print(`  investor holds ${prepared.holding.before / UNIT} ${SUNL_SYMBOL} before the calls run`);
  print(`  investor holds ${prepared.holding.after / UNIT} ${SUNL_SYMBOL} after they run`);
  print(`  ${VERDICT[prepared.verdict]}`);
  print('');
  print(`  Brickken listed ${prepared.listedBefore} offerings on ${SUNL_SYMBOL} before the call`);
  print(`  Brickken list ${prepared.listedAfter} after it, so the prepare opened nothing.`);
  recordOffering(OFFERING_FILE, prepared);
} catch (cause) {
  print(`  not prepared: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
