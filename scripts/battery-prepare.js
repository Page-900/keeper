import { registerAction } from '../dist/chain/executor.js';
import { SECOND_ACTION, explorerTransaction } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print(`Registering ${SECOND_ACTION.signature} on our own agent executor.`);
print('');
print('This is what makes the refused action case honest. Without it the executor stops an');
print('unknown call itself, before the registry is ever asked, and crediting that to the');
print('mandate would be a false claim. With it the executor is willing to forward the call');
print('and the mandate is the only thing that says no.');
print('');
print('No mandate enables this action, and a test holds that.');
print('');

try {
  const { transactionHash, blockNumber, spec } = await registerAction({
    action: SECOND_ACTION,
    anchor: 'register-second-action',
  });
  print(`  selector    ${SECOND_ACTION.selector}`);
  print(`  amount read from argument ${spec.amountIndex}`);
  print(`  block       ${blockNumber}`);
  print(`  transaction ${explorerTransaction(transactionHash)}`);
} catch (cause) {
  print(`  not registered: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
