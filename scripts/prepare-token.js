import { prepareTokenCreation } from '../dist/brickken/tokenization.js';
import { SUNL_SUPPLY_WHOLE, SUNL_SYMBOL } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

const VERDICT = {
  scaled: `Brickken read ${SUNL_SUPPLY_WHOLE} as whole tokens, which is what this project meant.`,
  unscaled: `Brickken read ${SUNL_SUPPLY_WHOLE} as base units. DO NOT SEND: the supply would be dust.`,
  absent: 'Neither supply appears in the calldata. Nothing is assumed. Read it before sending.',
};

print('');
print(`Asking Brickken what creating ${SUNL_SYMBOL} would send, without sending it.`);
print('Preparing sends no transaction, spends no gas, and creates nothing.');
print('');

try {
  const { txId, transactions, amount } = await prepareTokenCreation();
  print(`  prepared     ${txId}`);
  print(`  transactions ${transactions.length}`);
  for (const [index, transaction] of transactions.entries()) {
    print(`  ${index + 1}. to ${transaction.to}, ${transaction.data.length / 2 - 1} bytes`);
  }
  print('');
  print(`  supply       ${amount}`);
  print(`  ${VERDICT[amount]}`);
} catch (cause) {
  print(`  not prepared: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
