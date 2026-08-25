import { sendAgentAction } from '../dist/brickken/execute.js';
import { firstAction } from '../dist/chain/action.js';
import { SUNL_DECIMALS, SUNL_SYMBOL, explorerTransaction } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);
const action = firstAction();
const whole = action.amount / 10n ** BigInt(SUNL_DECIMALS);

print('');
print(`The agent moves ${whole} ${SUNL_SYMBOL} from the investor to ${action.to}.`);
print('It is signed by the agent, inside a mandate the investor signed. This happens once.');
print('');

try {
  const { txId, transactionHash } = await sendAgentAction({ action });
  print(`  prepared    ${txId}`);
  print(`  transaction ${explorerTransaction(transactionHash)}`);
  print('');
  print('Run npm run verify to read the balances and the running total off the chain.');
} catch (cause) {
  print(`  not sent: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
