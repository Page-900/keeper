import { readCanExecute, readRegistryState } from '../dist/chain/registry.js';
import { agreeWithChain, evaluate } from '../dist/chain/differential.js';
import {
  SUNL_DECIMALS,
  SUNL_SYMBOL,
  TRANSFER_ACTION,
  requireAddress,
} from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);
const whole = (amount) => amount / 10n ** BigInt(SUNL_DECIMALS);

print('');
print('Reading each rule the registry folds into one yes or no, and checking our reading');
print('against the registry itself at the same block. Nothing is sent.');
print('');

try {
  const state = await readRegistryState();
  const atBlock = BigInt(state.blockNumber);
  const cap = BigInt(state.maxTransactionValue);
  const headroom = BigInt(state.maxCumulativeValue) - BigInt(state.cumulativeUsed);

  const amounts = [
    ['at the per action limit', cap],
    ['one unit over the per action limit', cap + 1n],
    ['everything left under the lifetime limit', headroom],
    ['one unit over what is left for ever', headroom + 1n],
  ];

  print(
    `  block ${state.blockNumber}, ${whole(headroom)} ${SUNL_SYMBOL} left of the lifetime limit`,
  );
  print('');

  for (const [label, amount] of amounts) {
    const ours = evaluate(state, amount, requireAddress('asset'));
    const theirs = await readCanExecute({
      agent: requireAddress('agent'),
      principal: requireAddress('principal'),
      asset: requireAddress('asset'),
      action: TRANSFER_ACTION,
      amount,
      atBlock,
    });
    agreeWithChain(ours, theirs);
    const because = ours.firstFalse === null ? 'allowed' : `refused on ${ours.firstFalse}`;
    print(`  ${label}: ${because}, and the registry agrees`);
  }

  print('');
  print('Our reading and the registry agree on every amount tried.');
} catch (cause) {
  print(`  they do not agree: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
