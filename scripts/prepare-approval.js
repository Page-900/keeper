import { prepareExecutorApproval } from '../dist/brickken/tokenization.js';
import { PRINCIPAL_HOLDING_WHOLE, SUNL_SYMBOL, requireAddress } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

const VERDICT = {
  scaled: `Brickken read ${PRINCIPAL_HOLDING_WHOLE} as whole tokens, which is what this project meant.`,
  unscaled: `Brickken read ${PRINCIPAL_HOLDING_WHOLE} as base units. DO NOT SEND: the allowance would be dust.`,
  absent: 'Neither amount appears in the calldata. Nothing is assumed. Read it before sending.',
};

print('');
print(`Asking Brickken what approving ${PRINCIPAL_HOLDING_WHOLE} ${SUNL_SYMBOL} would send.`);
print(`The spender is the executor at ${requireAddress('executor')}, never the agent wallet.`);
print('');

try {
  const { txId, transactions, amount } = await prepareExecutorApproval();
  print(`  prepared     ${txId}`);
  print(`  transactions ${transactions.length}`);
  for (const [index, transaction] of transactions.entries()) {
    print(`  ${index + 1}. to ${transaction.to}, ${transaction.data.length / 2 - 1} bytes`);
  }
  print('');
  print(`  amount       ${amount}`);
  print(`  ${VERDICT[amount]}`);
} catch (cause) {
  print(`  not prepared: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
